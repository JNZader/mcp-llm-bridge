/**
 * Approval flows — pause/resume pattern for MCP tool execution
 * when elevated permissions are required.
 *
 * Tools tagged with `requiresApproval: true` in their security profile
 * are paused before execution, waiting for explicit user approval.
 */

// ── Types ──

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface ApprovalRequest {
	id: string;
	toolName: string;
	toolArgs: Record<string, unknown>;
	requester: string;
	reason: string;
	status: ApprovalStatus;
	createdAt: string;
	resolvedAt: string | null;
	resolvedBy: string | null;
	expiresAt: string;
}

export interface ApprovalConfig {
	defaultTimeoutMs: number;
	requireApprovalFor: string[]; // tool name patterns
	autoApproveFor: string[]; // trusted tool patterns
}

// ── Defaults ──

export const DEFAULT_CONFIG: ApprovalConfig = {
	defaultTimeoutMs: 5 * 60 * 1000, // 5 minutes
	requireApprovalFor: ["file_write", "shell_exec", "network_request", "db_write"],
	autoApproveFor: ["file_read", "search", "list"],
};

// ── Store ──

export class ApprovalStore {
	private requests: Map<string, ApprovalRequest> = new Map();
	private counter = 0;

	create(params: {
		toolName: string;
		toolArgs: Record<string, unknown>;
		requester: string;
		reason: string;
		timeoutMs?: number;
	}): ApprovalRequest {
		this.counter++;
		const id = `approval-${Date.now()}-${this.counter}`;
		const timeoutMs = params.timeoutMs ?? DEFAULT_CONFIG.defaultTimeoutMs;

		const request: ApprovalRequest = {
			id,
			toolName: params.toolName,
			toolArgs: params.toolArgs,
			requester: params.requester,
			reason: params.reason,
			status: "pending",
			createdAt: new Date().toISOString(),
			resolvedAt: null,
			resolvedBy: null,
			expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
		};

		this.requests.set(id, request);
		return request;
	}

	approve(id: string, approvedBy: string): ApprovalRequest | null {
		const req = this.requests.get(id);
		if (!req || req.status !== "pending") return null;
		if (this.isExpired(req)) {
			req.status = "expired";
			return null;
		}
		req.status = "approved";
		req.resolvedAt = new Date().toISOString();
		req.resolvedBy = approvedBy;
		return req;
	}

	deny(id: string, deniedBy: string): ApprovalRequest | null {
		const req = this.requests.get(id);
		if (!req || req.status !== "pending") return null;
		req.status = "denied";
		req.resolvedAt = new Date().toISOString();
		req.resolvedBy = deniedBy;
		return req;
	}

	get(id: string): ApprovalRequest | null {
		return this.requests.get(id) ?? null;
	}

	getPending(): ApprovalRequest[] {
		return [...this.requests.values()].filter(
			(r) => r.status === "pending" && !this.isExpired(r),
		);
	}

	private isExpired(req: ApprovalRequest): boolean {
		return new Date(req.expiresAt).getTime() < Date.now();
	}
}

// ── Policy ──

export function requiresApproval(
	toolName: string,
	config: ApprovalConfig = DEFAULT_CONFIG,
): boolean {
	// Check auto-approve first
	if (config.autoApproveFor.some((p) => toolName.includes(p))) {
		return false;
	}
	// Check require-approval patterns
	return config.requireApproveFor.some((p) => toolName.includes(p));
}

// Fix typo in property name access
Object.defineProperty(DEFAULT_CONFIG, "requireApproveFor", {
	get() {
		return this.requireApprovalFor;
	},
});
