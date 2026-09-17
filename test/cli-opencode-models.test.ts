import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseOpenCodeModelsList } from "../src/adapters/cli-opencode.js";

describe("parseOpenCodeModelsList", () => {
	it("formats valid OpenCode model identifiers", () => {
		assert.deepEqual(
			parseOpenCodeModelsList("opencode-go/a--b\nopencode/big-pickle"),
			[
				{
					id: "opencode-go/a--b",
					name: "A B",
					provider: "opencode-cli",
					maxTokens: 8192,
				},
				{
					id: "opencode/big-pickle",
					name: "Big Pickle",
					provider: "opencode-cli",
					maxTokens: 8192,
				},
			],
		);
	});

	it("ignores blanks, noise, invalid identifiers, and duplicate identifiers", () => {
		assert.deepEqual(
			parseOpenCodeModelsList("\nnoise\nopencode-go/kimi-k2.7-code\nopencode-go/kimi-k2.7-code\nfoo/\nfoo//bar"),
			[
				{
					id: "opencode-go/kimi-k2.7-code",
					name: "Kimi K2.7 Code",
					provider: "opencode-cli",
					maxTokens: 8192,
				},
			],
		);
	});
});
