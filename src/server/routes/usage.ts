import type { Context, Hono } from "hono";

import type { CostTracker, UsageQuery, UsageRecord, UsageSummary } from "../../core/cost-tracker.js";
import { normalizeTelemetryFailure } from "../../core/telemetry-failure.js";
import { safeError, toSafeHttpError } from "../../core/safe-error.js";

const SAFE_USAGE_GROUP_BY = ["provider", "model", "hour", "day"] as const;

const COMPATIBILITY_HEADERS = {
	Deprecation: "true",
	Link: "</v2/usage>; rel=\"successor-version\"",
} as const;

export type ReadbackScopeAuthorizer = (scope: string | undefined) => boolean;

export interface SafeUsageRecord {
	id: string;
	provider: string;
	model: string;
	tokensIn: number | null;
	tokensOut: number | null;
	totalTokens: number | null;
	costUsd: number | null;
	latencyMs: number;
	success: boolean;
	errorMessage: string | null;
	errorCode: string | null;
	errorCategory: string | null;
	createdAt: string;
}

export type SafeUsageSummary = Pick<UsageSummary,
	"totalRequests" | "totalTokensIn" | "totalTokensOut" | "totalTokens" | "totalCostUsd" |
	"knownCostUsd" | "unknownCostRequestCount" | "hasUnknownCost" | "avgLatencyMs" | "breakdown">;

export interface UsageRouteDeps {
	costTracker?: CostTracker;
	authorizeReadback?: ReadbackScopeAuthorizer;
}

export function projectUsageRecord(record: UsageRecord): SafeUsageRecord {
	const failure = record.errorCode
		? normalizeTelemetryFailure(record.errorCode)
		: record.errorMessage
			? normalizeTelemetryFailure(record.errorMessage)
			: undefined;

	return {
		id: `usage_${record.id}`,
		provider: record.provider,
		model: record.model,
		tokensIn: record.tokensIn,
		tokensOut: record.tokensOut,
		totalTokens: record.totalTokens,
		costUsd: record.costUsd,
		latencyMs: record.latencyMs,
		success: record.success,
		errorMessage: failure?.compatibilityText ?? null,
		errorCode: failure?.code ?? null,
		errorCategory: failure?.category ?? null,
		createdAt: record.createdAt,
	};
}

export function projectUsageSummary(summary: UsageSummary): SafeUsageSummary {
	return {
		totalRequests: summary.totalRequests,
		totalTokensIn: summary.totalTokensIn,
		totalTokensOut: summary.totalTokensOut,
		totalTokens: summary.totalTokens,
		totalCostUsd: summary.totalCostUsd,
		knownCostUsd: summary.knownCostUsd,
		unknownCostRequestCount: summary.unknownCostRequestCount,
		hasUnknownCost: summary.hasUnknownCost,
		avgLatencyMs: summary.avgLatencyMs,
		breakdown: summary.breakdown,
	};
}

export function getSafeUsageQuery(input: Record<string, unknown>): UsageQuery {
	const groupBy = SAFE_USAGE_GROUP_BY.find((value) => value === input["groupBy"]);
	return {
		provider: asOptionalString(input["provider"]),
		model: asOptionalString(input["model"]),
		project: asOptionalString(input["project"]),
		from: asOptionalString(input["from"]),
		to: asOptionalString(input["to"]),
		groupBy: groupBy as UsageQuery["groupBy"],
		limit: asOptionalNumber(input["limit"]),
	};
}

export function registerUsageRoutes(app: Hono, deps: UsageRouteDeps): void {
	const { costTracker, authorizeReadback } = deps;

	if (!costTracker) {
		return;
	}

	for (const [path, compatibility] of [["/v1/usage", true], ["/v2/usage", false]] as const) {
		app.get(path, (c) => {
		try {
			if (!authorizesProject(authorizeReadback, c.req.header("X-Telemetry-Scope"), c.req.query("project") ?? c.req.header("X-Project"))) return denied(c);
			const records = costTracker.query(getSafeUsageQuery({
				...c.req.query(), project: c.req.query("project") ?? c.req.header("X-Project"),
				limit: parseOptionalInt(c.req.query("limit")),
			}));
			return c.json(
				{ records: records.map(projectUsageRecord), count: records.length },
				200,
				compatibility ? COMPATIBILITY_HEADERS : undefined,
			);
		} catch {
			return c.json({ error: safeError("INTERNAL_ERROR").message }, 500);
		}
		});
	}

	for (const [path, compatibility] of [["/v1/usage/summary", true], ["/v2/usage/summary", false]] as const) {
		app.get(path, (c) => {
		try {
			if (!authorizesProject(authorizeReadback, c.req.header("X-Telemetry-Scope"), c.req.query("project") ?? c.req.header("X-Project"))) return denied(c);
			const query = getSafeUsageQuery({
				...c.req.query(), project: c.req.query("project") ?? c.req.header("X-Project"),
			});
			const summary = projectUsageSummary(costTracker.summary(query));
			return c.json(summary, 200, compatibility ? COMPATIBILITY_HEADERS : undefined);
		} catch {
			return c.json({ error: safeError("INTERNAL_ERROR").message }, 500);
		}
		});
	}
}

function denied(c: Context) {
	const safe = toSafeHttpError(safeError("ACCESS_DENIED"));
	return c.json(safe.body, 403);
}

function authorizesProject(
	authorizeReadback: ReadbackScopeAuthorizer | undefined,
	scope: string | undefined,
	project: string | undefined,
): boolean {
	try {
		return authorizeReadback?.(scope) === true && (project === undefined || project === scope);
	} catch {
		return false;
	}
}

function asOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function parseOptionalInt(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
