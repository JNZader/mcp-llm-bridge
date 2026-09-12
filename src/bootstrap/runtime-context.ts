import { bootstrapLocalLLM } from "./local-llm.js";
import {
	composeRuntimeContext,
	type RuntimeCompositionDependencies,
} from "./runtime-composition.js";
import { bootstrapRouterFeatures } from "./router-features.js";
import { createRuntimeFoundation } from "./runtime-foundation.js";
import { createSupportServices } from "./support-services.js";
import { createPluginRuntimeRegistry } from "../mcp-builder/plugin-runtime-registry.js";

export type { RuntimeContext } from "./runtime-composition.js";

const runtimeCompositionDependencies = {
	createRuntimeFoundation,
	bootstrapRouterFeatures,
	bootstrapLocalLLM,
	createSupportServices,
	createPluginRuntimeRegistry,
} satisfies RuntimeCompositionDependencies;

export function createRuntimeContext() {
	return composeRuntimeContext(runtimeCompositionDependencies);
}
