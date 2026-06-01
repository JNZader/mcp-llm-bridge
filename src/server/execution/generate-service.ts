import type { Context } from "hono";

import type { GenerateRequest as ValidatedGenerateRequest } from "../../core/schemas.js";
import type { Router } from "../../core/router.js";
import type { RequestLogger } from "../../logging/request-logger.js";
import { prepareGenerateRequest } from "../http-helpers/generate-request.js";

export interface ExecuteGenerateRequestInput {
	validated: ValidatedGenerateRequest;
	context: Context;
	router: Router;
	requestLogger?: RequestLogger;
	now?: () => number;
}

export async function executeGenerateRequest(
	input: ExecuteGenerateRequestInput,
) {
	const {
		validated,
		context,
		router,
		requestLogger,
		now = Date.now,
	} = input;
	const logCtx = requestLogger?.captureStart({
		provider: validated.provider || "unknown",
		model: validated.model || "unknown",
		startTime: now(),
	});

	try {
		const result = await router.generate(
			prepareGenerateRequest(validated, context),
		);

		if (logCtx && requestLogger) {
			await requestLogger.captureEnd(logCtx, {
				provider: result.resolvedProvider,
				model: result.resolvedModel,
				totalTokens: result.tokensUsed,
				responseData: JSON.stringify(result),
			});
		}

		return result;
	} catch (error) {
		if (logCtx && requestLogger) {
			await requestLogger.captureEnd(logCtx, {
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}

		throw error;
	}
}
