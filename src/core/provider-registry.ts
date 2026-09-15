import { normalizeProviderId } from "./provider-aliases.js";

export const BUILTIN_PROVIDER_IDS = Object.freeze([
	"anthropic",
	"openai",
	"google",
	"groq",
	"openrouter",
	"cerebras",
	"zai",
	"nvidia",
	"mistral",
	"sambanova",
	"hyperbolic",
	"opencode-cli",
	"claude-cli",
	"antigravity-cli",
	"codex-cli",
	"qwen-cli",
	"copilot-cli",
] as const);

// Telemetry is intentionally limited to identifiers the bridge understands.
// This is a sink-boundary allowlist, not a request-routing allowlist.
export const TELEMETRY_MODEL_IDS = Object.freeze([
	"gpt-4o",
	"gpt-4o-mini",
	"gpt-4",
	"gpt-4.1-mini",
	"gpt-3.5-turbo",
	"claude-3.5-sonnet",
	"claude-3-5-sonnet",
	"claude-3.5-haiku",
	"claude-3-haiku",
	"claude-3-opus",
	"claude-3",
	"llama3-70b",
] as const);

export const PROVIDER_REGISTRY_ERROR_CODE = Object.freeze({
	FROZEN: "PROVIDER_REGISTRY_FROZEN",
	DUPLICATE: "PROVIDER_REGISTRY_DUPLICATE",
	MISSING_REQUIRED: "PROVIDER_REGISTRY_MISSING_REQUIRED",
	NOT_FROZEN: "PROVIDER_REGISTRY_NOT_FROZEN",
} as const);

export const PROVIDER_REGISTRY_ERROR_MESSAGE = Object.freeze({
	[PROVIDER_REGISTRY_ERROR_CODE.FROZEN]: "Provider registry is frozen.",
	[PROVIDER_REGISTRY_ERROR_CODE.DUPLICATE]:
		"Provider registry contains duplicate provider identifiers.",
	[PROVIDER_REGISTRY_ERROR_CODE.MISSING_REQUIRED]:
		"Provider registry is missing required providers.",
	[PROVIDER_REGISTRY_ERROR_CODE.NOT_FROZEN]:
		"Provider registry must be frozen before startup.",
} as const);

export type ProviderRegistryErrorCode =
	(typeof PROVIDER_REGISTRY_ERROR_CODE)[keyof typeof PROVIDER_REGISTRY_ERROR_CODE];

export interface ProviderRegistryEntry {
	readonly id: string;
}

export class ProviderRegistryError extends Error {
	readonly code: ProviderRegistryErrorCode;

	constructor(code: ProviderRegistryErrorCode) {
		super(PROVIDER_REGISTRY_ERROR_MESSAGE[code]);
		this.name = "ProviderRegistryError";
		this.code = code;
	}
}

export function normalizeProviderName(providerId: string): string {
	return normalizeProviderId(providerId) ?? providerId;
}

export function isRegisteredTelemetryProvider(providerId: string): boolean {
	return (BUILTIN_PROVIDER_IDS as readonly string[]).includes(normalizeProviderName(providerId));
}

export function isRegisteredTelemetryModel(modelId: string): boolean {
	return (TELEMETRY_MODEL_IDS as readonly string[]).includes(modelId);
}

export function validateProviderRegistry(
	providers: readonly ProviderRegistryEntry[],
): void {
	const registeredProviderIds = new Set<string>();

	for (const provider of providers) {
		const providerId = normalizeProviderName(provider.id);
		if (registeredProviderIds.has(providerId)) {
			throw new ProviderRegistryError(PROVIDER_REGISTRY_ERROR_CODE.DUPLICATE);
		}
		registeredProviderIds.add(providerId);
	}

	for (const providerId of BUILTIN_PROVIDER_IDS) {
		if (!registeredProviderIds.has(providerId)) {
			throw new ProviderRegistryError(
				PROVIDER_REGISTRY_ERROR_CODE.MISSING_REQUIRED,
			);
		}
	}
}

export function assertProviderRegistryFrozen(registry: {
	readonly providerRegistryFrozen: boolean;
}): void {
	if (!registry.providerRegistryFrozen) {
		throw new ProviderRegistryError(PROVIDER_REGISTRY_ERROR_CODE.NOT_FROZEN);
	}
}
