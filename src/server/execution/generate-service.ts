import type { GenerateRequest as ValidatedGenerateRequest } from "../../core/schemas.js";
import type { Router } from "../../core/router.js";
import type { RequestLogger } from "../../logging/request-logger.js";
import { prepareGenerateRequest } from "../http-helpers/generate-request.js";
import type { RequestScope } from "../http-helpers/request-scope.js";

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
		now = Date.now,
	} = input;
	const logCtx = requestLogger?.captureStart({
		provider: validated.provider || "unknown",
		model: validated.model || "unknown",
		correlationId: scope.correlationId,
		startTime: now(),
	});

	try {
		const result = await router.generate(
			prepareGenerateRequest(validated, scope),
		);

		if (logCtx && requestLogger) {
			await requestLogger.captureEnd(logCtx, {
				provider: result.resolvedProvider,
				model: result.resolvedModel,
				totalTokens: result.tokensUsed,
				attempts: resolveAttemptsFromRouting(result),
				responseData: JSON.stringify(result),
			});
		}

		return result;
	} catch (error) {
		if (logCtx && requestLogger) {
			await requestLogger.captureEnd(logCtx, {
				attempts: 1,
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}

		throw error;
	}
}
