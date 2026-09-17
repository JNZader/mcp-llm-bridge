const DEFAULT_LOG_PAYLOAD_MAX_LENGTH = 10_000;

/** Serialize log data without allowing large values or serialization errors to escape. */
export function serializeLogPayload(
	data: unknown,
	maxLength = DEFAULT_LOG_PAYLOAD_MAX_LENGTH,
): string | undefined {
	if (data === undefined || data === null) {
		return undefined;
	}

	const limit = Math.max(0, Math.floor(maxLength));
	if (typeof data === "string") {
		return data.slice(0, limit);
	}

	try {
		const serialized = JSON.stringify(data, (_key, value: unknown) =>
			typeof value === "string" ? value.slice(0, limit) : value,
		);
		return typeof serialized === "string" ? serialized.slice(0, limit) : undefined;
	} catch {
		return undefined;
	}
}
