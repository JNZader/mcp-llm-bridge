export type BodyLimitResult =
	| { ok: true; request: Request }
	| { ok: false };

/**
 * Reject oversized bodies using Content-Length when present, then count
 * actual bytes so chunked/omitted-length requests cannot bypass the cap.
 */
export async function enforceBodySizeLimit(
	request: Request,
	maxSize: number,
): Promise<BodyLimitResult> {
	const contentLength = request.headers.get("content-length");
	if (contentLength) {
		const declared = Number.parseInt(contentLength, 10);
		if (Number.isFinite(declared) && declared > maxSize) {
			return { ok: false };
		}
	}

	if (!request.body) {
		return { ok: true, request };
	}

	let size = 0;
	const chunks: Uint8Array[] = [];
	const reader = request.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		size += value.byteLength;
		if (size > maxSize) {
			await reader.cancel();
			return { ok: false };
		}
		chunks.push(value);
	}

	return {
		ok: true,
		request: new Request(request, {
			body: new ReadableStream({
				start(controller) {
					for (const chunk of chunks) {
						controller.enqueue(chunk);
					}
					controller.close();
				},
			}),
			duplex: "half",
		} as RequestInit),
	};
}
