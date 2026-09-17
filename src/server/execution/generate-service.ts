import type { GenerateRequest as ValidatedGenerateRequest } from "../../core/schemas.js";
import type { GenerateResponse } from "../../core/types.js";
import { GENERATE_COMPLETE_STOP } from "../../core/types.js";
import type { Router } from "../../core/router.js";
import type { RequestLogger } from "../../logging/request-logger.js";
import { serializeLogPayload } from "../../logging/serialize-log-payload.js";
import { prepareGenerateRequest } from "../http-helpers/generate-request.js";
import type { RequestScope } from "../http-helpers/request-scope.js";
import { estimateZeroCostEvidence } from "../../core/usage-provenance.js";
import { sanitizeError } from "../../core/error-sanitizer.js";

function withConsumerStopReason(result: GenerateResponse): GenerateResponse {
	const stopReason =
		result.stop_reason ??
		result.finish_reason ??
		result.stop ??
		GENERATE_COMPLETE_STOP.STOP;
	return {
		...result,
		stop_reason: stopReason,
		finish_reason: result.finish_reason ?? stopReason,
	};
}

function resolveAttemptsFromRouting(result: {
	routing?: { attemptedProviders?: string[] };
}): number {
	return result.routing?.attemptedProviders?.length ?? 1;
}

export interface ExecuteGenerateRequestInput {
	validated: ValidatedGenerateRequest;
	scope: RequestScope;
	router: Router;
  requestLogger?: RequestLogger;
  abortSignal?: AbortSignal;
	now?: () => number;
}

export async function executeGenerateRequest(
	input: ExecuteGenerateRequestInput,
) {
	const {
		validated,
		scope,
		router,
    requestLogger,
    abortSignal,
		now = Date.now,
	} = input;
	const logCtx = requestLogger?.captureStart({
		provider: validated.provider || "unknown",
		model: validated.model || "unknown",
		correlationId: scope.correlationId,
		startTime: now(),
	});

	try {
		const result = withConsumerStopReason(
			await router.generate(prepareGenerateRequest(validated, scope), { signal: abortSignal }),
		);

		await captureEndSafely(requestLogger, logCtx, {
			provider: result.resolvedProvider,
			model: result.resolvedModel,
			totalTokens: result.tokensUsed,
			attempts: resolveAttemptsFromRouting(result),
			responseData: serializeLogPayload(result),
		});

		const costEvidence = estimateZeroCostEvidence(result.resolvedModel, result.usageProvenance);
		return costEvidence ? { ...result, costEvidence } : result;
	} catch (error) {
		await captureEndSafely(requestLogger, logCtx, {
			attempts: 1,
			error: sanitizeError(error),
		});

		throw error;
	}
}

async function captureEndSafely(
	requestLogger: RequestLogger | undefined,
	logCtx: ReturnType<RequestLogger["captureStart"]> | undefined,
	input: Parameters<RequestLogger["captureEnd"]>[1],
): Promise<void> {
	if (!logCtx || !requestLogger) {
		return;
	}

	try {
		await requestLogger.captureEnd(logCtx, input);
	} catch {
		// Logging must not fail a successful generate or replace the original error.
	}
}
