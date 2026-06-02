import type { StreamRecorder } from "../../core/cost-tracker.js";
import { getCircuitBreakerV2, type ResolvedStreamingProvider } from "../../core/router.js";
import type {
	CaptureEndInput,
	RequestLogger,
} from "../../logging/request-logger.js";
import type { LogContext } from "../../logging/types.js";

export interface StreamingRequestLogFinalizer {
	logCtx?: LogContext;
	finalizeRequestLog: (input?: CaptureEndInput) => Promise<void>;
}

interface StreamingAttemptTelemetryInput {
	providerId: string;
	resolvedModel: string;
	attemptStartTime: number;
	project?: string;
	requestedProvider?: string;
	requestedModel?: string;
	attemptedProviders?: string[];
	attempts?: number;
	totalTokens?: number;
	inputTokens?: number;
	outputTokens?: number;
	streamRecorder?: StreamRecorder;
	recordResult?: ResolvedStreamingProvider["recordResult"];
}

interface StreamingAttemptSuccessInput extends StreamingAttemptTelemetryInput {
	finalizeRequestLog: (input?: CaptureEndInput) => Promise<void>;
	responseModel?: string;
}

interface StreamingAttemptFailureInput extends StreamingAttemptTelemetryInput {
	error: unknown;
	emittedMeaningfulContent: boolean;
	finalizeRequestLog: (input?: CaptureEndInput) => Promise<void>;
}

interface StreamingAttemptAbortInput extends StreamingAttemptTelemetryInput {
	error: unknown;
	finalizeRequestLog: (input?: CaptureEndInput) => Promise<void>;
}

export function normalizeStreamingError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

export function createStreamingRequestLogFinalizer(
	requestLogger: RequestLogger | undefined,
	requestedModel: string | undefined,
	correlationId?: string,
): StreamingRequestLogFinalizer {
	const logCtx = requestLogger?.captureStart({
		provider: "unknown",
		model: requestedModel || "unknown",
		correlationId,
		startTime: Date.now(),
	});
	let logCompleted = false;

	const finalizeRequestLog = async (input: CaptureEndInput = {}) => {
		if (!requestLogger || !logCtx || logCompleted) {
			return;
		}

		logCompleted = true;
		await requestLogger.captureEnd(logCtx, input);
	};

	return { logCtx, finalizeRequestLog };
}

export async function finalizeStreamingAttemptSuccess(
	input: StreamingAttemptSuccessInput,
): Promise<void> {
	const {
		providerId,
		resolvedModel,
		attemptStartTime,
		project,
		requestedProvider,
		requestedModel,
		attemptedProviders,
		attempts,
		totalTokens,
		inputTokens,
		outputTokens,
		streamRecorder,
		recordResult,
		finalizeRequestLog,
		responseModel,
	} = input;

	getCircuitBreakerV2().recordSuccess(providerId, "default", resolvedModel);
	streamRecorder?.finish();
	recordResult?.({
		model: resolvedModel,
		totalTokens,
		tokensIn: inputTokens,
		tokensOut: outputTokens,
		latencyMs: Date.now() - attemptStartTime,
		success: true,
		attempt: attempts,
		project,
	});
	await finalizeRequestLog({
		provider: providerId,
		model: responseModel ?? resolvedModel,
		attempts,
		totalTokens,
		inputTokens,
		outputTokens,
		responseData: buildStreamingResponseData({
			providerId,
			requestedProvider,
			requestedModel,
			resolvedModel,
			responseModel,
			attemptedProviders,
		}),
	});
}

export async function finalizeStreamingAttemptFailure(
	input: StreamingAttemptFailureInput,
): Promise<Error> {
	const {
		providerId,
		resolvedModel,
		attemptStartTime,
		project,
		attempts,
		totalTokens,
		inputTokens,
		outputTokens,
		streamRecorder,
		recordResult,
		error,
		emittedMeaningfulContent,
		finalizeRequestLog,
	} = input;
	const resolvedError = normalizeStreamingError(error);
	const message = resolvedError.message;

	getCircuitBreakerV2().recordFailure(providerId, "default", resolvedModel);
	streamRecorder?.finish(message);
	recordResult?.({
		model: resolvedModel,
		totalTokens,
		tokensIn: inputTokens,
		tokensOut: outputTokens,
		latencyMs: Date.now() - attemptStartTime,
		success: false,
		attempt: attempts,
		project,
		errorMessage: message,
	});

	if (emittedMeaningfulContent) {
		await finalizeRequestLog({
			provider: providerId,
			model: resolvedModel,
			attempts,
			totalTokens,
			inputTokens,
			outputTokens,
			error: resolvedError,
		});
	}

	return resolvedError;
}

export async function finalizeStreamingAttemptAbort(
	input: StreamingAttemptAbortInput,
): Promise<Error> {
	const {
		providerId,
		resolvedModel,
		attemptStartTime,
		project,
		attempts,
		totalTokens,
		inputTokens,
		outputTokens,
		streamRecorder,
		recordResult,
		error,
		finalizeRequestLog,
	} = input;
	const resolvedError = normalizeStreamingError(error);
	const message = resolvedError.message;

	streamRecorder?.finish(message);
	recordResult?.({
		model: resolvedModel,
		totalTokens,
		tokensIn: inputTokens,
		tokensOut: outputTokens,
		latencyMs: Date.now() - attemptStartTime,
		success: false,
		attempt: attempts,
		project,
		errorMessage: message,
	});
	await finalizeRequestLog({
		provider: providerId,
		model: resolvedModel,
		attempts,
		totalTokens,
		inputTokens,
		outputTokens,
		error: resolvedError,
	});

	return resolvedError;
}

interface StreamingResponseDataInput {
	providerId: string;
	requestedProvider?: string;
	requestedModel?: string;
	resolvedModel: string;
	responseModel?: string;
	attemptedProviders?: string[];
}

function buildStreamingResponseData(input: StreamingResponseDataInput) {
	const {
		providerId,
		requestedProvider,
		requestedModel,
		resolvedModel,
		responseModel,
		attemptedProviders,
	} = input;
	const routing =
		attemptedProviders && attemptedProviders.length > 0
			? { attemptedProviders: [...attemptedProviders] }
			: undefined;

	return {
		stream: true,
		provider: providerId,
		model: responseModel ?? resolvedModel,
		requestedProvider,
		requestedModel,
		resolvedProvider: providerId,
		resolvedModel,
		fallbackUsed:
			attemptedProviders !== undefined && attemptedProviders.length > 0
				? attemptedProviders[0] !== providerId
				: false,
		routing,
	};
}
