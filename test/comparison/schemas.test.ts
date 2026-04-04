/**
 * Tests for CompareRequestSchema validation.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CompareRequestSchema } from "../../src/comparison/schemas.js";

describe("CompareRequestSchema", () => {
	it("valid request passes parse", () => {
		const result = CompareRequestSchema.parse({
			prompt: "What is 2+2?",
			models: ["gpt-4", "claude-3-opus"],
		});
		assert.equal(result.prompt, "What is 2+2?");
		assert.deepEqual(result.models, ["gpt-4", "claude-3-opus"]);
		assert.equal(result.persist, false);
		assert.equal(result.maxTokens, 1024);
		assert.equal(result.timeoutMs, 30_000);
	});

	it("valid request with all optional fields", () => {
		const result = CompareRequestSchema.parse({
			prompt: "Hello world",
			system: "You are helpful",
			models: ["gpt-4", "claude-3-opus", "gemini-pro"],
			maxTokens: 512,
			timeoutMs: 10_000,
			maxEstimatedCost: 0.5,
			persist: true,
			project: "my-project",
		});
		assert.equal(result.system, "You are helpful");
		assert.equal(result.maxTokens, 512);
		assert.equal(result.persist, true);
	});

	it("rejects fewer than 2 models", () => {
		assert.throws(() => {
			CompareRequestSchema.parse({
				prompt: "test",
				models: ["gpt-4"],
			});
		});
	});

	it("rejects more than 5 models", () => {
		assert.throws(() => {
			CompareRequestSchema.parse({
				prompt: "test",
				models: ["a", "b", "c", "d", "e", "f"],
			});
		});
	});

	it("rejects duplicate models", () => {
		assert.throws(() => {
			CompareRequestSchema.parse({
				prompt: "test",
				models: ["gpt-4", "gpt-4"],
			});
		});
	});

	it("rejects empty prompt", () => {
		assert.throws(() => {
			CompareRequestSchema.parse({
				prompt: "",
				models: ["gpt-4", "claude-3-opus"],
			});
		});
	});

	it("rejects timeoutMs > 120000", () => {
		assert.throws(() => {
			CompareRequestSchema.parse({
				prompt: "test",
				models: ["gpt-4", "claude-3-opus"],
				timeoutMs: 120_001,
			});
		});
	});

	it("allows timeoutMs = 120000", () => {
		const result = CompareRequestSchema.parse({
			prompt: "test",
			models: ["gpt-4", "claude-3-opus"],
			timeoutMs: 120_000,
		});
		assert.equal(result.timeoutMs, 120_000);
	});

	it("rejects negative maxEstimatedCost", () => {
		assert.throws(() => {
			CompareRequestSchema.parse({
				prompt: "test",
				models: ["gpt-4", "claude-3-opus"],
				maxEstimatedCost: -0.5,
			});
		});
	});

	it("rejects zero maxEstimatedCost (must be positive)", () => {
		assert.throws(() => {
			CompareRequestSchema.parse({
				prompt: "test",
				models: ["gpt-4", "claude-3-opus"],
				maxEstimatedCost: 0,
			});
		});
	});
});
