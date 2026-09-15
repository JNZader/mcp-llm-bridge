import { safeOperation, safeOperationError } from "../../core/safe-operation.js";
import type { RouterExecutionContract } from "../../core/router-execution-contract.js";
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
	attempts?: number;
	totalTokens?: number;
	inputTokens?: number;
	outputTokens?: number;
	executionContract: RouterExecutionContract;
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
		await requestLogger.captureEnd(logCtx, sanitizeRequestLogInput(input));
	};

	return { logCtx, finalizeRequestLog };
}

function sanitizeRequestLogInput(input: CaptureEndInput): CaptureEndInput {
	return input.error === undefined
		? input
		: { ...input, error: safeOperationError(safeOperation("failed")) };
}

export async function finalizeStreamingAttemptSuccess(
	input: StreamingAttemptSuccessInput,
): Promise<void> {
	const {
		providerId,
		resolvedModel,
		attemptStartTime,
		project,
		attempts,
		totalTokens,
		inputTokens,
		outputTokens,
		recordResult,
		finalizeRequestLog,
		responseModel,
	} = input;

	getCircuitBreakerV2().recordSuccess(providerId, "default", resolvedModel);
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
		recordResult,
		error,
		emittedMeaningfulContent,
		finalizeRequestLog,
	} = input;
	const resolvedError = normalizeStreamingError(error);
	const message = safeOperationError(safeOperation("failed")).message;

	getCircuitBreakerV2().recordFailure(providerId, "default", resolvedModel);
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
		recordResult,
		error,
		finalizeRequestLog,
	} = input;
	const resolvedError = normalizeStreamingError(error);
	const message = safeOperationError(safeOperation("failed")).message;

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
