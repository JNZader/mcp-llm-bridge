import type { Vault } from "../../vault/vault.js";

/** Provider-specific base URLs for OpenAI-compatible streaming. */
const PROVIDER_STREAM_BASE_URLS: Record<string, string> = {
	google: "https://generativelanguage.googleapis.com/v1beta/openai/",
	groq: "https://api.groq.com/openai/v1",
	openrouter: "https://openrouter.ai/api/v1",
};

/**
 * Build a providerCall function that creates a streaming SDK call
 * using credentials from the Vault.
 */
export function buildProviderStreamCall(
	providerId: string,
	vault?: Vault,
	project?: string,
	abortSignal?: AbortSignal,
): (request: unknown) => AsyncIterable<unknown> {
	return async function* streamCall(request: unknown): AsyncIterable<unknown> {
		const body = request as Record<string, unknown>;

		if (providerId === "anthropic") {
			const Anthropic = (await import("@anthropic-ai/sdk")).default;
			let client: InstanceType<typeof Anthropic>;

			if (vault) {
				const oauthToken = await vault.getClaudeOAuthToken(project);
				if (oauthToken?.accessToken) {
					client = new Anthropic({ authToken: oauthToken.accessToken });
				} else {
					const apiKey = vault.getDecrypted("anthropic", "default", project);
					client = new Anthropic({ apiKey });
				}
			} else {
				client = new Anthropic();
			}

			const { stream: _stream, ...restBody } = body;

			const messageStream = client.messages.stream(
				restBody as unknown as Parameters<typeof client.messages.stream>[0],
				abortSignal ? { signal: abortSignal } : undefined,
			);
			for await (const event of messageStream) {
				yield event;
			}
			return;
		}

		const OpenAI = (await import("openai")).default;
		let apiKey = "";

		if (vault) {
			try {
				apiKey = vault.getDecrypted(providerId, "default", project);
			} catch {
				// Vault may not have credentials for this provider
			}
		}

		const baseURL = PROVIDER_STREAM_BASE_URLS[providerId];
		const client = new OpenAI({
			apiKey,
			...(baseURL ? { baseURL } : {}),
		});

		const { stream: _stream, stream_options: _so, ...restBody } = body;

		const streamResponse = await client.chat.completions.create({
			...(restBody as unknown as Parameters<typeof client.chat.completions.create>[0]),
			stream: true,
			stream_options: { include_usage: true },
		}, abortSignal ? { signal: abortSignal } : undefined);

		for await (const chunk of streamResponse) {
			yield chunk;
		}
	};
}
