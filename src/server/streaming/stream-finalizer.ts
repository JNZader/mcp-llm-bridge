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
	streamStartTime: number;
	project?: string;
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

export function normalizeStreamingError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

export function createStreamingRequestLogFinalizer(
	requestLogger: RequestLogger | undefined,
	requestedModel: string | undefined,
): StreamingRequestLogFinalizer {
	const logCtx = requestLogger?.captureStart({
		provider: "unknown",
		model: requestedModel || "unknown",
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
		streamStartTime,
		project,
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
		tokensIn: inputTokens,
		tokensOut: outputTokens,
		latencyMs: Date.now() - streamStartTime,
		success: true,
		project,
	});
	await finalizeRequestLog({
		provider: providerId,
		model: responseModel ?? resolvedModel,
		inputTokens,
		outputTokens,
		responseData: {
			stream: true,
			provider: providerId,
			model: responseModel,
		},
	});
}

export async function finalizeStreamingAttemptFailure(
	input: StreamingAttemptFailureInput,
): Promise<Error> {
	const {
		providerId,
		resolvedModel,
		streamStartTime,
		project,
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
		tokensIn: inputTokens,
		tokensOut: outputTokens,
		latencyMs: Date.now() - streamStartTime,
		success: false,
		project,
		errorMessage: message,
	});

	if (emittedMeaningfulContent) {
		await finalizeRequestLog({
			provider: providerId,
			model: resolvedModel,
			inputTokens,
			outputTokens,
			error: resolvedError,
		});
	}

	return resolvedError;
}
