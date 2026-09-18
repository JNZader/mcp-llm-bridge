import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { enforceBodySizeLimit } from "../src/server/http-helpers/body-limit.js";

function streamBody(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});
}

describe("enforceBodySizeLimit", () => {
	it("rejects a declared Content-Length over the cap", async () => {
		const request = new Request("http://127.0.0.1/v1/generate", {
			method: "POST",
			headers: { "content-length": "50" },
			body: "tiny",
		});
		const result = await enforceBodySizeLimit(request, 10);
		assert.equal(result.ok, false);
	});

	it("rejects a streamed body that exceeds the cap without Content-Length", async () => {
		const request = new Request("http://127.0.0.1/v1/generate", {
			method: "POST",
			body: streamBody(["aaaaaa", "bbbbbb"]),
			duplex: "half",
		} as RequestInit);
		const result = await enforceBodySizeLimit(request, 10);
		assert.equal(result.ok, false);
	});

	it("rebuilds a readable body when the stream is under the cap", async () => {
		const request = new Request("http://127.0.0.1/v1/generate", {
			method: "POST",
			body: streamBody(["ok"]),
			duplex: "half",
		} as RequestInit);
		const result = await enforceBodySizeLimit(request, 10);
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(await result.request.text(), "ok");
		}
	});
});
