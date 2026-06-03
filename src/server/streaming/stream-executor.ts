import type { CostTracker } from "../../core/cost-tracker.js";
import type { InternalLLMRequest } from "../../core/internal-model.js";
import type { RouterExecutionContract } from "../../core/router-execution-contract.js";
import type { ResolvedStreamingProvider, Router } from "../../core/router.js";
import type { GenerateResponse } from "../../core/types.js";
import type { RequestLogger } from "../../logging/request-logger.js";
import type { InternalLLMChunk } from "../../transformers/streaming.js";
import type { Vault } from "../../vault/vault.js";
import {
	buildChatGenerateRequest,
	buildChatInternalRequestFromMessages,
} from "../http-helpers/chat-request.js";
import type { RequestScope } from "../http-helpers/request-scope.js";
import { buildProviderStreamCall } from "./provider-stream-client.js";
import {
	createStreamingRequestLogFinalizer,
	finalizeStreamingAttemptAbort,
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
	scope: RequestScope;
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
		vault,
		requestLogger,
		scope,
		abortSignal,
		providerStreamCallFactory = buildProviderStreamCall,
	} = input;
	const { logCtx, finalizeRequestLog } = createStreamingRequestLogFinalizer(
		requestLogger,
		canonical.model,
		scope.correlationId,
	);
	const providerAbortController = new AbortController();

	let inputTokens: number | undefined;
	let outputTokens: number | undefined;
	let totalTokens: number | undefined;
	let attempts = 0;
	let streamingExecutionContract: RouterExecutionContract | undefined;
	let aborted = abortSignal?.aborted ?? false;
	let abortFinalization: Promise<void> | undefined;
	let activeProviderId: string | undefined;
	let activeResolvedModel: string | undefined;
	let activeAttemptStartTime: number | undefined;
	let activeRecordResult: ResolvedStreamingProvider["recordResult"] | undefined;

	const clearActiveAttemptTelemetry = () => {
		activeProviderId = undefined;
		activeResolvedModel = undefined;
		activeAttemptStartTime = undefined;
		activeRecordResult = undefined;
	};

	const internalRequest: InternalLLMRequest = buildChatInternalRequestFromMessages(
		canonical,
		canonical.messages.map((message) => ({
			role: message.role as "system" | "user" | "assistant",
			content: message.content,
		})),
		scope,
	);

	const finalizeAbort = async () => {
		aborted = true;
		if (!providerAbortController.signal.aborted) {
			providerAbortController.abort();
		}

		const abortError = new Error("Stream aborted by client");

		abortFinalization ??=
			activeProviderId && activeResolvedModel && activeAttemptStartTime
				? finalizeStreamingAttemptAbort({
						providerId: activeProviderId,
						resolvedModel: activeResolvedModel,
						attemptStartTime: activeAttemptStartTime,
						project: scope.project,
						executionContract: requireStreamingExecutionContract(streamingExecutionContract),
						attempts,
						totalTokens,
						inputTokens,
						outputTokens,
						recordResult: activeRecordResult,
						error: abortError,
						finalizeRequestLog,
					}).then(() => undefined)
				: finalizeRequestLog({
						attempts,
						totalTokens,
						inputTokens,
						outputTokens,
						error: abortError,
					});

		await abortFinalization;
		clearActiveAttemptTelemetry();
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
				streamingExecutionContract = resolvedCandidates[0]?.executionContract;

				if (resolvedCandidates.length === 0) {
					let result: GenerateResponse;
					try {
						result = await router.generate(buildChatGenerateRequest(canonical, scope));
					} catch (error) {
						if (aborted || isAbortError(error)) {
							await finalizeAbort();
							return;
						}

						await finalizeRequestLog({
							attempts,
							error: normalizeStreamingError(error),
						});
						throw error;
					}

					if (aborted) {
						totalTokens = result.tokensUsed;
						await finalizeAbort();
						return;
					}

					attempts = resolveAttemptsFromRouting(result);
					totalTokens = result.tokensUsed;
					await finalizeRequestLog({
						provider: result.resolvedProvider,
						model: result.resolvedModel,
						attempts,
						totalTokens,
						responseData: result,
					});
					await output.writeFallbackResult(result);
					await output.writeDone();
					return;
				}

				let lastStreamingError: Error | undefined;

				for (const resolved of resolvedCandidates) {
					attempts += 1;
					if (aborted) {
						await finalizeAbort();
						return;
					}

					const { provider, request: resolvedRequest, streamTransformer, onSuccess, recordResult } =
						resolved;
					const executionContract = requireResolvedExecutionContract(resolved);
					streamingExecutionContract ??= executionContract;
					executionContract.recordAttempt(provider.id);
					const attemptStartTime = Date.now();
					let breakerModel = resolvedRequest.model || canonical.model || "unknown";
					let attemptInputTokens: number | undefined;
					let attemptOutputTokens: number | undefined;
					let emittedMeaningfulContent = false;
					const pendingChunks: InternalLLMChunk[] = [];

					if (logCtx) {
						logCtx.provider = provider.id;
						logCtx.model = breakerModel;
					}

					activeProviderId = provider.id;
					activeResolvedModel = breakerModel;
					activeAttemptStartTime = attemptStartTime;
					activeRecordResult = recordResult;

					try {
						const providerCall = providerStreamCallFactory(
							provider.id,
							vault,
							scope.project,
							providerAbortController.signal,
						);
						const chunks = streamTransformer.transformStream(resolvedRequest, providerCall);

						for await (const chunk of chunks) {
							if (aborted) {
								break;
							}

							if (chunk.tokensIn !== undefined) {
								attemptInputTokens = chunk.tokensIn;
								inputTokens = chunk.tokensIn;
							}
							if (chunk.tokensOut !== undefined) {
								attemptOutputTokens = chunk.tokensOut;
								outputTokens = chunk.tokensOut;
							}
							totalTokens =
								typeof inputTokens === "number" && typeof outputTokens === "number"
									? inputTokens + outputTokens
									: undefined;
							if (chunk.model && logCtx) {
								logCtx.model = chunk.model;
								breakerModel = chunk.model;
								activeResolvedModel = chunk.model;
							} else if (chunk.model) {
								breakerModel = chunk.model;
								activeResolvedModel = chunk.model;
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
						totalTokens =
							typeof attemptInputTokens === "number" && typeof attemptOutputTokens === "number"
								? attemptInputTokens + attemptOutputTokens
								: undefined;

						if (aborted) {
							await finalizeAbort();
							return;
						}

						await output.writeDone();
						await finalizeStreamingAttemptSuccess({
							providerId: provider.id,
							resolvedModel: breakerModel,
							attemptStartTime,
							project: scope.project,
							executionContract,
							attempts,
							totalTokens,
							inputTokens,
							outputTokens,
							recordResult,
							finalizeRequestLog,
							responseModel: logCtx?.model,
						});
						clearActiveAttemptTelemetry();
						onSuccess?.();
						return;
					} catch (error) {
						if (aborted || isAbortError(error)) {
							inputTokens = attemptInputTokens;
							outputTokens = attemptOutputTokens;
							totalTokens =
								typeof attemptInputTokens === "number" && typeof attemptOutputTokens === "number"
									? attemptInputTokens + attemptOutputTokens
									: undefined;
							await finalizeAbort();
							return;
						}

						const resolvedError = await finalizeStreamingAttemptFailure({
							providerId: provider.id,
							resolvedModel: breakerModel,
							attemptStartTime,
							project: scope.project,
							attempts,
							totalTokens:
								typeof attemptInputTokens === "number" && typeof attemptOutputTokens === "number"
									? attemptInputTokens + attemptOutputTokens
									: undefined,
							inputTokens: attemptInputTokens,
							outputTokens: attemptOutputTokens,
							recordResult,
							error,
							emittedMeaningfulContent,
							finalizeRequestLog,
						});
						clearActiveAttemptTelemetry();

						if (!emittedMeaningfulContent) {
							lastStreamingError = resolvedError;
							continue;
						}

						inputTokens = attemptInputTokens;
						outputTokens = attemptOutputTokens;
						totalTokens =
							typeof attemptInputTokens === "number" && typeof attemptOutputTokens === "number"
								? attemptInputTokens + attemptOutputTokens
								: undefined;
						await output.writeTerminalError(resolvedError);
						return;
					}
				}

				const resolvedError =
					lastStreamingError ?? new Error("No streaming providers available");
				await finalizeRequestLog({ attempts, error: resolvedError });
				await output.writeTerminalError(resolvedError);
			} finally {
				if (abortSignal) {
					abortSignal.removeEventListener("abort", onAbort);
				}
			}
		},
	};
}

function resolveAttemptsFromRouting(result: {
	routing?: { attemptedProviders?: string[] };
}): number {
	return result.routing?.attemptedProviders?.length ?? 1;
}

function requireResolvedExecutionContract(
	resolved: Pick<ResolvedStreamingProvider, "provider" | "executionContract">,
): RouterExecutionContract {
	if (!resolved.executionContract) {
		throw new Error(
			`Streaming provider ${resolved.provider.id} resolved without executionContract`,
		);
	}

	return resolved.executionContract;
}

function requireStreamingExecutionContract(
	contract: RouterExecutionContract | undefined,
): RouterExecutionContract {
	if (!contract) {
		throw new Error("Streaming execution contract was not initialized");
	}

	return contract;
}

function isAbortError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	return error.name === "AbortError" || error.message.toLowerCase().includes("abort");
}
