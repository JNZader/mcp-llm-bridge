import type { Context } from "hono";

import type { GenerateRequest as ValidatedGenerateRequest } from "../../core/schemas.js";
import type { GenerateRequest } from "../../core/types.js";
import { optimizeMessages } from "../../transformers/three-part-prompt.js";

import { resolveRequestProject } from "./request-validation.js";

export function prepareGenerateRequest(
	validated: ValidatedGenerateRequest,
	c: Context,
): GenerateRequest {
	const project = resolveRequestProject(validated.project, c);

	let prompt = validated.prompt ?? "";
	let system = validated.system;

	if (validated.context || validated.instruction) {
		const parts: string[] = [];
		if (validated.context) {
			parts.push(`[Context]\n${validated.context}`);
		}
		if (validated.instruction) {
			parts.push(`[Instruction]\n${validated.instruction}`);
		}
		prompt = parts.join("\n\n");
	} else if (prompt && !system) {
		const optimized = optimizeMessages([{ role: "user", content: prompt }]);
		if (
			optimized.length > 1 &&
			optimized[0]?.role === "system" &&
			typeof optimized[0].content === "string"
		) {
			system = optimized[0].content;
			prompt = optimized
				.slice(1)
				.map((message) =>
					typeof message.content === "string" ? message.content : "",
				)
				.filter(Boolean)
				.join("\n\n");
		}
	}

	return {
		prompt,
		system,
		model: validated.model,
		provider: validated.provider,
		maxTokens: validated.maxTokens,
		strict: validated.strict,
		project,
	};
}
