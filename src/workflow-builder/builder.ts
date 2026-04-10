/**
 * Visual workflow builder — DAG-based MCP tool orchestration.
 *
 * Defines workflows as directed acyclic graphs where each node
 * is an MCP tool call and edges define data flow between tools.
 * The visual canvas is a separate concern — this is the engine.
 */

// ── Types ──

export interface WorkflowNode {
	id: string;
	toolName: string;
	label: string;
	inputs: Record<string, string | WorkflowRef>;
	position?: { x: number; y: number };
}

export interface WorkflowRef {
	nodeId: string;
	outputKey: string;
}

export interface WorkflowEdge {
	from: string;
	to: string;
	fromOutput: string;
	toInput: string;
}

export interface Workflow {
	id: string;
	name: string;
	description: string;
	nodes: WorkflowNode[];
	edges: WorkflowEdge[];
	createdAt: string;
}

export interface ExecutionStep {
	nodeId: string;
	toolName: string;
	status: "pending" | "running" | "completed" | "failed" | "skipped";
	inputs: Record<string, unknown>;
	outputs: Record<string, unknown>;
	error?: string;
	durationMs?: number;
}

export interface WorkflowExecution {
	workflowId: string;
	steps: ExecutionStep[];
	status: "pending" | "running" | "completed" | "failed";
	startedAt?: string;
	completedAt?: string;
}

// ── Builder ──

export function createWorkflow(
	name: string,
	description: string = "",
): Workflow {
	return {
		id: `wf-${Date.now().toString(36)}`,
		name,
		description,
		nodes: [],
		edges: [],
		createdAt: new Date().toISOString(),
	};
}

export function addNode(
	workflow: Workflow,
	toolName: string,
	label: string,
	inputs: Record<string, string | WorkflowRef> = {},
): WorkflowNode {
	const node: WorkflowNode = {
		id: `node-${workflow.nodes.length + 1}`,
		toolName,
		label,
		inputs,
	};
	workflow.nodes.push(node);
	return node;
}

export function addEdge(
	workflow: Workflow,
	from: string,
	to: string,
	fromOutput: string,
	toInput: string,
): WorkflowEdge {
	const edge: WorkflowEdge = { from, to, fromOutput, toInput };
	workflow.edges.push(edge);
	return edge;
}

// ── Validation ──

export interface ValidationError {
	type: "missing-node" | "cycle" | "missing-input" | "orphan";
	message: string;
	nodeId?: string;
}

export function validateWorkflow(workflow: Workflow): ValidationError[] {
	const errors: ValidationError[] = [];
	const nodeIds = new Set(workflow.nodes.map((n) => n.id));

	// Check edges reference valid nodes
	for (const edge of workflow.edges) {
		if (!nodeIds.has(edge.from)) {
			errors.push({
				type: "missing-node",
				message: `Edge references non-existent source node: ${edge.from}`,
				nodeId: edge.from,
			});
		}
		if (!nodeIds.has(edge.to)) {
			errors.push({
				type: "missing-node",
				message: `Edge references non-existent target node: ${edge.to}`,
				nodeId: edge.to,
			});
		}
	}

	// Check for cycles using DFS
	if (hasCycle(workflow)) {
		errors.push({
			type: "cycle",
			message: "Workflow contains a cycle — must be a DAG",
		});
	}

	// Check for orphan nodes (no edges)
	if (workflow.nodes.length > 1) {
		const connected = new Set<string>();
		for (const edge of workflow.edges) {
			connected.add(edge.from);
			connected.add(edge.to);
		}
		for (const node of workflow.nodes) {
			if (!connected.has(node.id)) {
				errors.push({
					type: "orphan",
					message: `Node "${node.label}" has no connections`,
					nodeId: node.id,
				});
			}
		}
	}

	return errors;
}

function hasCycle(workflow: Workflow): boolean {
	const adj = new Map<string, string[]>();
	for (const node of workflow.nodes) {
		adj.set(node.id, []);
	}
	for (const edge of workflow.edges) {
		adj.get(edge.from)?.push(edge.to);
	}

	const visited = new Set<string>();
	const inStack = new Set<string>();

	function dfs(nodeId: string): boolean {
		if (inStack.has(nodeId)) return true;
		if (visited.has(nodeId)) return false;

		visited.add(nodeId);
		inStack.add(nodeId);

		for (const neighbor of adj.get(nodeId) ?? []) {
			if (dfs(neighbor)) return true;
		}

		inStack.delete(nodeId);
		return false;
	}

	for (const node of workflow.nodes) {
		if (dfs(node.id)) return true;
	}

	return false;
}

// ── Topological sort (execution order) ──

export function getExecutionOrder(workflow: Workflow): string[] {
	const adj = new Map<string, string[]>();
	const inDegree = new Map<string, number>();

	for (const node of workflow.nodes) {
		adj.set(node.id, []);
		inDegree.set(node.id, 0);
	}

	for (const edge of workflow.edges) {
		adj.get(edge.from)?.push(edge.to);
		inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
	}

	const queue: string[] = [];
	for (const [nodeId, degree] of inDegree) {
		if (degree === 0) queue.push(nodeId);
	}

	const order: string[] = [];
	while (queue.length > 0) {
		const current = queue.shift()!;
		order.push(current);

		for (const neighbor of adj.get(current) ?? []) {
			const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
			inDegree.set(neighbor, newDegree);
			if (newDegree === 0) queue.push(neighbor);
		}
	}

	return order;
}

// ── Execution tracking ──

export function createExecution(workflow: Workflow): WorkflowExecution {
	const order = getExecutionOrder(workflow);

	return {
		workflowId: workflow.id,
		steps: order.map((nodeId) => {
			const node = workflow.nodes.find((n) => n.id === nodeId)!;
			return {
				nodeId,
				toolName: node.toolName,
				status: "pending" as const,
				inputs: {},
				outputs: {},
			};
		}),
		status: "pending",
	};
}

// ── Serialization ──

export function serializeWorkflow(workflow: Workflow): string {
	return JSON.stringify(workflow, null, 2);
}

export function deserializeWorkflow(json: string): Workflow {
	return JSON.parse(json) as Workflow;
}
