import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	addEdge,
	addNode,
	createExecution,
	createWorkflow,
	deserializeWorkflow,
	getExecutionOrder,
	serializeWorkflow,
	validateWorkflow,
} from "../src/workflow-builder/builder.js";

describe("createWorkflow", () => {
	it("creates empty workflow", () => {
		const wf = createWorkflow("test");
		assert.equal(wf.name, "test");
		assert.equal(wf.nodes.length, 0);
		assert.equal(wf.edges.length, 0);
		assert.ok(wf.id.startsWith("wf-"));
	});
});

describe("addNode", () => {
	it("adds node to workflow", () => {
		const wf = createWorkflow("test");
		const node = addNode(wf, "read_file", "Read Config");
		assert.equal(node.toolName, "read_file");
		assert.equal(node.label, "Read Config");
		assert.equal(wf.nodes.length, 1);
	});

	it("generates sequential IDs", () => {
		const wf = createWorkflow("test");
		const n1 = addNode(wf, "tool1", "Step 1");
		const n2 = addNode(wf, "tool2", "Step 2");
		assert.equal(n1.id, "node-1");
		assert.equal(n2.id, "node-2");
	});
});

describe("addEdge", () => {
	it("connects two nodes", () => {
		const wf = createWorkflow("test");
		const n1 = addNode(wf, "read", "Read");
		const n2 = addNode(wf, "transform", "Transform");
		const edge = addEdge(wf, n1.id, n2.id, "content", "input");
		assert.equal(edge.from, n1.id);
		assert.equal(edge.to, n2.id);
		assert.equal(wf.edges.length, 1);
	});
});

describe("validateWorkflow", () => {
	it("returns no errors for valid workflow", () => {
		const wf = createWorkflow("valid");
		const n1 = addNode(wf, "read", "Read");
		const n2 = addNode(wf, "write", "Write");
		addEdge(wf, n1.id, n2.id, "content", "data");
		const errors = validateWorkflow(wf);
		assert.equal(errors.length, 0);
	});

	it("detects missing source node", () => {
		const wf = createWorkflow("bad");
		addNode(wf, "write", "Write");
		addEdge(wf, "nonexistent", "node-1", "out", "in");
		const errors = validateWorkflow(wf);
		assert.ok(errors.some((e) => e.type === "missing-node"));
	});

	it("detects cycles", () => {
		const wf = createWorkflow("cycle");
		const n1 = addNode(wf, "a", "A");
		const n2 = addNode(wf, "b", "B");
		addEdge(wf, n1.id, n2.id, "out", "in");
		addEdge(wf, n2.id, n1.id, "out", "in");
		const errors = validateWorkflow(wf);
		assert.ok(errors.some((e) => e.type === "cycle"));
	});

	it("detects orphan nodes", () => {
		const wf = createWorkflow("orphan");
		const n1 = addNode(wf, "a", "A");
		const n2 = addNode(wf, "b", "B");
		addNode(wf, "c", "Orphan");
		addEdge(wf, n1.id, n2.id, "out", "in");
		const errors = validateWorkflow(wf);
		assert.ok(errors.some((e) => e.type === "orphan"));
	});

	it("passes single node without edges", () => {
		const wf = createWorkflow("single");
		addNode(wf, "a", "Solo");
		const errors = validateWorkflow(wf);
		assert.equal(errors.length, 0);
	});
});

describe("getExecutionOrder", () => {
	it("returns topological order", () => {
		const wf = createWorkflow("topo");
		const n1 = addNode(wf, "a", "A");
		const n2 = addNode(wf, "b", "B");
		const n3 = addNode(wf, "c", "C");
		addEdge(wf, n1.id, n2.id, "out", "in");
		addEdge(wf, n2.id, n3.id, "out", "in");
		const order = getExecutionOrder(wf);
		assert.deepEqual(order, [n1.id, n2.id, n3.id]);
	});

	it("handles diamond dependency", () => {
		const wf = createWorkflow("diamond");
		const n1 = addNode(wf, "source", "Source");
		const n2 = addNode(wf, "left", "Left");
		const n3 = addNode(wf, "right", "Right");
		const n4 = addNode(wf, "merge", "Merge");
		addEdge(wf, n1.id, n2.id, "out", "in");
		addEdge(wf, n1.id, n3.id, "out", "in");
		addEdge(wf, n2.id, n4.id, "out", "in");
		addEdge(wf, n3.id, n4.id, "out", "in");

		const order = getExecutionOrder(wf);
		assert.equal(order[0], n1.id);
		assert.equal(order[3], n4.id);
		assert.equal(order.length, 4);
	});
});

describe("createExecution", () => {
	it("creates execution with pending steps", () => {
		const wf = createWorkflow("exec");
		const n1 = addNode(wf, "read", "Read");
		const n2 = addNode(wf, "write", "Write");
		addEdge(wf, n1.id, n2.id, "content", "data");

		const exec = createExecution(wf);
		assert.equal(exec.status, "pending");
		assert.equal(exec.steps.length, 2);
		assert.equal(exec.steps[0].toolName, "read");
		assert.ok(exec.steps.every((s) => s.status === "pending"));
	});
});

describe("serialization", () => {
	it("roundtrips workflow", () => {
		const wf = createWorkflow("serial");
		const n1 = addNode(wf, "read", "Read");
		const n2 = addNode(wf, "write", "Write");
		addEdge(wf, n1.id, n2.id, "content", "data");

		const json = serializeWorkflow(wf);
		const restored = deserializeWorkflow(json);
		assert.equal(restored.name, wf.name);
		assert.equal(restored.nodes.length, 2);
		assert.equal(restored.edges.length, 1);
	});
});
