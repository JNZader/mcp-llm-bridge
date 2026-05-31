import type { CostTracker } from "../../core/cost-tracker.js";
import type { InternalLLMRequest } from "../../core/internal-model.js";
import type { Router } from "../../core/router.js";
import type { GenerateResponse } from "../../core/types.js";
import type { RequestLogger } from "../../logging/request-logger.js";
import type { CanonicalRequest } from "../../protocol-converter/types.js";
import type { InternalLLMChunk } from "../../transformers/streaming.js";
import type { Vault } from "../../vault/vault.js";
import { buildChatGenerateRequest } from "../http-helpers/chat-request.js";
import { buildProviderStreamCall } from "./provider-stream-client.js";
import {
	createStreamingRequestLogFinalizer,
	finalizeStreamingAttemptFailure,
	finalizeStreamingAttemptSuccess,
	normalizeStreamingError,
} from "./stream-finalizer.js";

export interface StreamExecutorOutput {
	writeChunk: (chunk: InternalLLMChunk) => Promise<void>;
	writeFallbackResult: (result: GenerateResponse) => Promise<void>;
	writeTerminalError: (error: Error) => Promise<void>;
	writeDone: () => Promise<void>;
}

export interface CreateStreamExecutorInput {
	canonical: CanonicalRequest;
	router: Router;
	costTracker?: CostTracker;
	vault?: Vault;
	requestLogger?: RequestLogger;
	project?: string;
	abortSignal?: AbortSignal;
	providerStreamCallFactory?: typeof buildProviderStreamCall;
}

export interface StreamExecutor {
	execute: (output: StreamExecutorOutput) => Promise<void>;
	abort: () => Promise<void>;
}

export function createStreamExecutor(input: CreateStreamExecutorInput): StreamExecutor {
	const {
		canonical,
		router,
		costTracker,
		vault,
		requestLogger,
		project,
		abortSignal,
		providerStreamCallFactory = buildProviderStreamCall,
	} = input;
	const streamStartTime = Date.now();
	const { logCtx, finalizeRequestLog } = createStreamingRequestLogFinalizer(
		requestLogger,
		canonical.model,
	);
	const providerAbortController = new AbortController();

	let inputTokens: number | undefined;
	let outputTokens: number | undefined;
	let aborted = abortSignal?.aborted ?? false;
	let abortFinalization: Promise<void> | undefined;

	const internalMessages = canonical.messages.map((message) => ({
		role: message.role as "system" | "user" | "assistant",
		content: message.content,
	}));

	const internalRequest: InternalLLMRequest = {
		messages: internalMessages,
		model: canonical.model,
		maxTokens: canonical.max_tokens,
		metadata: {
			...(typeof canonical["clientId"] === "string"
				? { clientId: canonical["clientId"] }
				: {}),
			...(typeof canonical["provider"] === "string"
				? { provider: canonical["provider"] }
				: {}),
			...(canonical["strict"] === true ? { strict: true } : {}),
		},
	};

	const finalizeAbort = async () => {
		aborted = true;
		if (!providerAbortController.signal.aborted) {
			providerAbortController.abort();
		}

		abortFinalization ??= finalizeRequestLog({
			inputTokens,
			outputTokens,
			error: new Error("Stream aborted by client"),
		});

		await abortFinalization;
	};

	const onAbort = () => {
		void finalizeAbort();
	};

	if (abortSignal) {
		abortSignal.addEventListener("abort", onAbort, { once: true });
	}

	return {
		abort: finalizeAbort,
		execute: async (output) => {
			try {
				if (aborted) {
					await finalizeAbort();
					return;
				}

				const resolvedCandidates = await router.resolveStreamingProviders(internalRequest);

				if (resolvedCandidates.length === 0) {
					let result: GenerateResponse;
					try {
						result = await router.generate(buildChatGenerateRequest(canonical, project));
					} catch (error) {
						if (aborted || isAbortError(error)) {
							await finalizeAbort();
							return;
						}

						await finalizeRequestLog({
							error: normalizeStreamingError(error),
						});
						throw error;
					}

					if (aborted) {
						outputTokens = result.tokensUsed || 0;
						await finalizeAbort();
						return;
					}

					outputTokens = result.tokensUsed || 0;
					await finalizeRequestLog({
						outputTokens,
						responseData: result,
					});
					await output.writeFallbackResult(result);
					await output.writeDone();
					return;
				}

				let lastStreamingError: Error | undefined;

				for (const resolved of resolvedCandidates) {
					if (aborted) {
						await finalizeAbort();
						return;
					}

					const { provider, request: resolvedRequest, streamTransformer, onSuccess, recordResult } =
						resolved;
					let breakerModel = resolvedRequest.model || canonical.model || "unknown";
					let attemptInputTokens: number | undefined;
					let attemptOutputTokens: number | undefined;
					let emittedMeaningfulContent = false;
					const pendingChunks: InternalLLMChunk[] = [];

					if (logCtx) {
						logCtx.provider = provider.id;
						logCtx.model = breakerModel;
					}

					const streamRecorder = costTracker?.recordStream(
						provider.id,
						breakerModel,
						project,
					);

					try {
						const providerCall = providerStreamCallFactory(
							provider.id,
							vault,
							project,
							providerAbortController.signal,
						);
						const chunks = streamTransformer.transformStream(resolvedRequest, providerCall);

						for await (const chunk of chunks) {
							if (aborted) {
								break;
							}

							streamRecorder?.addChunk(
								{ tokensIn: chunk.tokensIn, tokensOut: chunk.tokensOut },
								chunk.content.length,
							);

							if (chunk.tokensIn !== undefined) {
								attemptInputTokens = chunk.tokensIn;
							}
							if (chunk.tokensOut !== undefined) {
								attemptOutputTokens = chunk.tokensOut;
							}
							if (chunk.model && logCtx) {
								logCtx.model = chunk.model;
								breakerModel = chunk.model;
							} else if (chunk.model) {
								breakerModel = chunk.model;
							}

							const chunkHasContent = chunk.content.length > 0;

							if (!emittedMeaningfulContent && !chunkHasContent && !chunk.done) {
								pendingChunks.push(chunk);
								continue;
							}

							if (!emittedMeaningfulContent && (chunkHasContent || chunk.done)) {
								emittedMeaningfulContent = chunkHasContent;
								for (const pendingChunk of pendingChunks) {
									await output.writeChunk(pendingChunk);
								}
							}

							await output.writeChunk(chunk);
						}

						inputTokens = attemptInputTokens;
						outputTokens = attemptOutputTokens;

						if (aborted) {
							await finalizeAbort();
							return;
						}

						await output.writeDone();
						await finalizeStreamingAttemptSuccess({
							providerId: provider.id,
							resolvedModel: breakerModel,
							streamStartTime,
							project,
							inputTokens,
							outputTokens,
							streamRecorder,
							recordResult,
							finalizeRequestLog,
							responseModel: logCtx?.model,
						});
						onSuccess?.();
						return;
					} catch (error) {
						if (aborted || isAbortError(error)) {
							inputTokens = attemptInputTokens;
							outputTokens = attemptOutputTokens;
							await finalizeAbort();
							return;
						}

						const resolvedError = await finalizeStreamingAttemptFailure({
							providerId: provider.id,
							resolvedModel: breakerModel,
							streamStartTime,
							project,
							inputTokens: attemptInputTokens,
							outputTokens: attemptOutputTokens,
							streamRecorder,
							recordResult,
							error,
							emittedMeaningfulContent,
							finalizeRequestLog,
						});

						if (!emittedMeaningfulContent) {
							lastStreamingError = resolvedError;
							continue;
						}

						inputTokens = attemptInputTokens;
						outputTokens = attemptOutputTokens;
						await output.writeTerminalError(resolvedError);
						return;
					}
				}

				const resolvedError =
					lastStreamingError ?? new Error("No streaming providers available");
				await finalizeRequestLog({ error: resolvedError });
				await output.writeTerminalError(resolvedError);
			} finally {
				if (abortSignal) {
					abortSignal.removeEventListener("abort", onAbort);
				}
			}
		},
	};
}

function isAbortError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	return error.name === "AbortError" || error.message.toLowerCase().includes("abort");
}
