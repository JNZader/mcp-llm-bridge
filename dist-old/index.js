#!/usr/bin/env node
import {
  createDashboardJwt,
  exchangeCodeForUser,
  getGithubAuthUrl,
  isGithubOauthConfigured,
  isUserAllowed
} from "./chunk-2BDEDDWJ.js";
import {
  childLogger,
  logger
} from "./chunk-WGKIBMFP.js";

// src/core/tracing.ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { trace, context, SpanStatusCode } from "@opentelemetry/api";

// src/core/constants.ts
var VERSION = "0.3.1";
var GLOBAL_PROJECT = "_global";
var MIN_AUTH_TOKEN_LENGTH = 32;
var DEFAULT_HTTP_PORT = 3456;
var DEFAULT_DB_FILENAME = "vault.db";
var DEFAULT_MASTER_KEY_FILENAME = "master.key";
var MASTER_KEY_BYTES = 32;
var MASK_VISIBLE_CHARS = 7;
var MASK_SUFFIX = "...***";
var MAX_BODY_SIZE = 1e6;
var MAX_PROMPT_LENGTH = 102400;
var VALID_PROVIDERS = /* @__PURE__ */ new Set([
  "anthropic",
  "openai",
  "google",
  "groq",
  "openrouter",
  "opencode-cli",
  "claude-cli",
  "gemini-cli",
  "codex-cli",
  "qwen-cli",
  "copilot-cli"
]);

// src/core/pricing.ts
var PRICE_TABLE = {
  // ── Anthropic ─────────────────────────────────────────
  "claude-sonnet-4-20250514": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-opus-4-20250514": { inputPerMTok: 15, outputPerMTok: 75 },
  "claude-3.5-sonnet": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-3.5-haiku": { inputPerMTok: 0.8, outputPerMTok: 4 },
  "claude-3-opus": { inputPerMTok: 15, outputPerMTok: 75 },
  "claude-3-sonnet": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-3-haiku": { inputPerMTok: 0.25, outputPerMTok: 1.25 },
  // ── OpenAI ────────────────────────────────────────────
  "gpt-4o": { inputPerMTok: 2.5, outputPerMTok: 10 },
  "gpt-4o-mini": { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  "gpt-4-turbo": { inputPerMTok: 10, outputPerMTok: 30 },
  "gpt-4": { inputPerMTok: 30, outputPerMTok: 60 },
  "o1": { inputPerMTok: 15, outputPerMTok: 60 },
  "o1-mini": { inputPerMTok: 3, outputPerMTok: 12 },
  "o3": { inputPerMTok: 10, outputPerMTok: 40 },
  "o3-mini": { inputPerMTok: 1.1, outputPerMTok: 4.4 },
  "o4-mini": { inputPerMTok: 1.1, outputPerMTok: 4.4 },
  // ── Google ────────────────────────────────────────────
  "gemini-2.5-pro": { inputPerMTok: 1.25, outputPerMTok: 10 },
  "gemini-2.5-flash": { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  "gemini-2.0-flash": { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  "gemini-1.5-pro": { inputPerMTok: 1.25, outputPerMTok: 5 },
  "gemini-1.5-flash": { inputPerMTok: 0.075, outputPerMTok: 0.3 },
  // ── Groq ──────────────────────────────────────────────
  "llama-3.3-70b-versatile": { inputPerMTok: 0.59, outputPerMTok: 0.79 },
  "llama-3.1-8b-instant": { inputPerMTok: 0.05, outputPerMTok: 0.08 },
  "mixtral-8x7b-32768": { inputPerMTok: 0.24, outputPerMTok: 0.24 },
  "gemma2-9b-it": { inputPerMTok: 0.2, outputPerMTok: 0.2 }
};
function normalizeModelName(model) {
  return model.toLowerCase().replace(/\./g, "-").replace(/-\d{8}$/, "").replace(/-latest$/, "");
}
function findPrice(model) {
  const normalized = normalizeModelName(model);
  const normalizedTable = /* @__PURE__ */ new Map();
  for (const [key, price] of Object.entries(PRICE_TABLE)) {
    normalizedTable.set(normalizeModelName(key), price);
  }
  const exact = normalizedTable.get(normalized);
  if (exact) return exact;
  let bestMatch = null;
  let bestLength = 0;
  for (const [key, price] of normalizedTable) {
    if (normalized.startsWith(key) && key.length > bestLength) {
      bestMatch = price;
      bestLength = key.length;
    }
  }
  return bestMatch;
}
function calculateCost(model, inputTokens, outputTokens) {
  const strippedModel = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
  const price = findPrice(strippedModel);
  if (!price) {
    logger.warn({ model }, "Unknown model for pricing \u2014 cost defaulting to $0");
    return 0;
  }
  const inputCost = inputTokens / 1e6 * price.inputPerMTok;
  const outputCost = outputTokens / 1e6 * price.outputPerMTok;
  return inputCost + outputCost;
}
function getPriceTable() {
  return { ...PRICE_TABLE };
}
function estimateCost(model, inputTokens, outputTokens) {
  const strippedModel = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
  const price = findPrice(strippedModel);
  if (!price) {
    return null;
  }
  const inputCost = inputTokens / 1e6 * price.inputPerMTok;
  const outputCost = outputTokens / 1e6 * price.outputPerMTok;
  return {
    model,
    inputTokens,
    outputTokens,
    estimatedCost: inputCost + outputCost,
    pricePerMTok: { input: price.inputPerMTok, output: price.outputPerMTok },
    currency: "USD"
  };
}

// src/core/tracing.ts
var sdk = null;
function initTracing() {
  if (sdk) return;
  const enabled = process.env["LLM_GATEWAY_TRACING_ENABLED"] === "true";
  if (!enabled) {
    return;
  }
  const endpoint = process.env["LLM_GATEWAY_OTLP_ENDPOINT"] ?? "http://localhost:4318/v1/traces";
  const traceExporter = new OTLPTraceExporter({
    url: endpoint
  });
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]: "mcp-llm-bridge",
      [SEMRESATTRS_SERVICE_VERSION]: VERSION
    }),
    traceExporter,
    instrumentations: [
      new HttpInstrumentation(),
      new PinoInstrumentation()
    ]
  });
  sdk.start();
  process.on("SIGTERM", async () => {
    await sdk?.shutdown();
  });
}
async function shutdownTracing() {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}

// src/adapters/cli-home.ts
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, normalize } from "path";
function assertSafeFileName(fileName) {
  const normalized = normalize(fileName).replace(/\\/g, "/");
  if (!fileName || isAbsolute(fileName) || normalized.startsWith("../") || normalized === "..") {
    throw new Error(`Unsafe provider file path: ${fileName}`);
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error(`Unsafe provider file path: ${fileName}`);
  }
  return normalized;
}
function computeFilesHash(files) {
  const content = files.map((f) => `${f.fileName}:${f.content}`).join("|");
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
var homeDirCache = /* @__PURE__ */ new Map();
function materializeProviderHome(providerDir, files, project) {
  const safeProvider = providerDir.replace(/^\.+/, "").replace(/[^a-zA-Z0-9-_]/g, "-");
  const cacheKey = `${safeProvider}:${project ?? "_global"}`;
  const newHash = computeFilesHash(files);
  const cached = homeDirCache.get(cacheKey);
  if (cached && cached.filesHash === newHash) {
    return {
      homeDir: cached.homeDir,
      targetDir: cached.targetDir,
      cleanup: () => {
      }
    };
  }
  if (cached) {
    try {
      rmSync(cached.homeDir, { recursive: true, force: true });
    } catch {
    }
  }
  const hashSuffix = newHash.substring(0, 8);
  const homeDir = `/tmp/llm-gw/${safeProvider}-${hashSuffix}`;
  const targetDir = join(homeDir, `.${safeProvider}`);
  mkdirSync(targetDir, { recursive: true, mode: 448 });
  for (const file of files) {
    const safeFileName = assertSafeFileName(file.fileName);
    const targetPath = join(targetDir, safeFileName);
    mkdirSync(dirname(targetPath), { recursive: true, mode: 448 });
    writeFileSync(targetPath, file.content, { mode: 384 });
  }
  homeDirCache.set(cacheKey, { homeDir, targetDir, filesHash: newHash });
  return {
    homeDir,
    targetDir,
    cleanup: () => {
      homeDirCache.delete(cacheKey);
      try {
        rmSync(homeDir, { recursive: true, force: true });
      } catch {
      }
    }
  };
}
function cleanupAllProviderHomes() {
  for (const cached of homeDirCache.values()) {
    try {
      rmSync(cached.homeDir, { recursive: true, force: true });
    } catch {
    }
  }
  homeDirCache.clear();
}

// src/adapters/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";
var AnthropicAdapter = class {
  constructor(vault2) {
    this.vault = vault2;
  }
  id = "anthropic";
  name = "Anthropic";
  type = "api";
  models = [
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic", maxTokens: 8192 },
    { id: "claude-haiku-4-20250414", name: "Claude Haiku 4", provider: "anthropic", maxTokens: 8192 }
  ];
  // Client cache per auth mode to avoid recreating connections
  clientCache = /* @__PURE__ */ new Map();
  /**
   * Determine the auth mode to use.
   *
   * Priority:
   * 1. OAuth token from Claude CLI (preferred for Pro/Max)
   * 2. API key from Vault
   *
   * @param project - Optional project scope
   * @returns Auth mode to use
   */
  async getAuthMode(project) {
    const oauthToken = await this.vault.getClaudeOAuthToken(project);
    if (oauthToken?.accessToken) {
      return { type: "oauth", token: oauthToken.accessToken };
    }
    try {
      const apiKey = this.vault.getDecrypted("anthropic", "default", project);
      return { type: "api-key", key: apiKey };
    } catch {
      throw new Error("No Anthropic credentials available. Set up OAuth with Claude CLI or add an API key to the vault.");
    }
  }
  /**
   * Get cache key for the client based on auth mode.
   */
  getAuthCacheKey(auth) {
    return auth.type === "oauth" ? `oauth:${auth.token.slice(0, 16)}` : `key:${auth.key.slice(0, 16)}`;
  }
  /**
   * Get or create a cached Anthropic client for the given auth mode.
   */
  getClient(auth) {
    const cacheKey = this.getAuthCacheKey(auth);
    if (!this.clientCache.has(cacheKey)) {
      const config2 = auth.type === "oauth" ? { token: auth.token } : { apiKey: auth.key };
      this.clientCache.set(cacheKey, new Anthropic(config2));
    }
    return this.clientCache.get(cacheKey);
  }
  async generate(request) {
    const auth = await this.getAuthMode(request.project);
    const client = this.getClient(auth);
    const model = request.model ?? "claude-sonnet-4-20250514";
    const response = await client.messages.create({
      model,
      max_tokens: request.maxTokens ?? 4096,
      system: request.system ?? "",
      messages: [{ role: "user", content: request.prompt }]
    });
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return {
      text,
      provider: this.id,
      model,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      resolvedProvider: this.id,
      resolvedModel: model,
      fallbackUsed: false
    };
  }
  async isAvailable() {
    const oauthToken = this.vault.getClaudeOAuthTokenSync();
    if (oauthToken) {
      return true;
    }
    return this.vault.has("anthropic");
  }
};

// src/adapters/openai.ts
import OpenAI from "openai";
var OpenAIAdapter = class {
  constructor(vault2) {
    this.vault = vault2;
  }
  id = "openai";
  name = "OpenAI";
  type = "api";
  models = [
    { id: "gpt-4o", name: "GPT-4o", provider: "openai", maxTokens: 4096 },
    { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", maxTokens: 4096 },
    { id: "o3-mini", name: "o3-mini", provider: "openai", maxTokens: 4096 }
  ];
  // Client cache per apiKey to avoid recreating connections
  clientCache = /* @__PURE__ */ new Map();
  /**
   * Get or create a cached OpenAI client for the given apiKey.
   */
  getClient(apiKey) {
    if (!this.clientCache.has(apiKey)) {
      this.clientCache.set(apiKey, new OpenAI({ apiKey }));
    }
    return this.clientCache.get(apiKey);
  }
  async generate(request) {
    const apiKey = this.vault.getDecrypted("openai", "default", request.project);
    const client = this.getClient(apiKey);
    const model = request.model ?? "gpt-4o";
    const messages = [];
    if (request.system) messages.push({ role: "system", content: request.system });
    messages.push({ role: "user", content: request.prompt });
    const response = await client.chat.completions.create({
      model,
      max_tokens: request.maxTokens ?? 4096,
      messages
    });
    return {
      text: response.choices[0]?.message?.content ?? "",
      provider: this.id,
      model,
      tokensUsed: response.usage?.total_tokens ?? void 0,
      resolvedProvider: this.id,
      resolvedModel: model,
      fallbackUsed: false
    };
  }
  async isAvailable() {
    return this.vault.has("openai");
  }
};

// src/adapters/base-adapter.ts
import OpenAI2 from "openai";
var BaseOpenAICompatibleAdapter = class {
  constructor(vault2) {
    this.vault = vault2;
  }
  defaultHeaders;
  type = "api";
  // Client cache per apiKey to avoid recreating TLS connections
  clientCache = /* @__PURE__ */ new Map();
  /**
   * Get or create a cached OpenAI client for the given apiKey.
   * Caching avoids TLS handshake overhead on every request.
   */
  getClient(apiKey) {
    if (!this.clientCache.has(apiKey)) {
      this.clientCache.set(apiKey, new OpenAI2({
        apiKey,
        baseURL: this.baseURL,
        defaultHeaders: this.defaultHeaders
      }));
    }
    return this.clientCache.get(apiKey);
  }
  /**
   * Generate text using the OpenAI-compatible API.
   */
  async generate(request) {
    const apiKey = this.vault.getDecrypted(this.id, "default", request.project);
    const client = this.getClient(apiKey);
    const model = request.model ?? this.defaultModel;
    const messages = [];
    if (request.system) {
      messages.push({ role: "system", content: request.system });
    }
    messages.push({ role: "user", content: request.prompt });
    const response = await client.chat.completions.create({
      model,
      max_tokens: request.maxTokens ?? this.models[0]?.maxTokens ?? 4096,
      messages
    });
    return {
      text: response.choices[0]?.message?.content ?? "",
      provider: this.id,
      model,
      tokensUsed: response.usage?.total_tokens ?? void 0,
      resolvedProvider: this.id,
      resolvedModel: model,
      fallbackUsed: false
    };
  }
  /**
   * Check if the provider is available (has credentials in vault).
   */
  async isAvailable() {
    return this.vault.has(this.id);
  }
};

// src/adapters/google.ts
var GoogleAdapter = class extends BaseOpenAICompatibleAdapter {
  id = "google";
  name = "Google";
  baseURL = "https://generativelanguage.googleapis.com/v1beta/openai/";
  models = [
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google", maxTokens: 8192 },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "google", maxTokens: 8192 },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "google", maxTokens: 8192 }
  ];
  defaultModel = "gemini-2.5-flash";
  constructor(vault2) {
    super(vault2);
  }
};

// src/adapters/groq.ts
var GroqAdapter = class extends BaseOpenAICompatibleAdapter {
  id = "groq";
  name = "Groq";
  baseURL = "https://api.groq.com/openai/v1";
  models = [
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B", provider: "groq", maxTokens: 4096 },
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile", provider: "groq", maxTokens: 4096 },
    { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", provider: "groq", maxTokens: 4096 }
  ];
  defaultModel = "llama-3.3-70b-versatile";
  constructor(vault2) {
    super(vault2);
  }
};

// src/adapters/openrouter.ts
var OpenRouterAdapter = class extends BaseOpenAICompatibleAdapter {
  id = "openrouter";
  name = "OpenRouter";
  baseURL = "https://openrouter.ai/api/v1";
  models = [
    { id: "deepseek/deepseek-chat", name: "DeepSeek Chat", provider: "openrouter", maxTokens: 4096 },
    { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", provider: "openrouter", maxTokens: 4096 },
    { id: "openai/gpt-4o", name: "GPT-4o", provider: "openrouter", maxTokens: 4096 },
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "openrouter", maxTokens: 4096 }
  ];
  defaultModel = "deepseek/deepseek-chat";
  defaultHeaders = {
    "HTTP-Referer": "https://github.com/JNZader/mcp-llm-bridge"
  };
  constructor(vault2) {
    super(vault2);
  }
};

// src/adapters/cli-opencode.ts
import { existsSync, mkdirSync as mkdirSync2, writeFileSync as writeFileSync2, rmSync as rmSync2 } from "fs";
import { join as join2 } from "path";

// src/adapters/cli-utils.ts
import { execFileSync, execFile } from "child_process";

// src/security/sanitize.ts
var API_KEY_PATTERNS = [
  // Anthropic: sk-ant-*
  /sk-ant-[a-zA-Z0-9_-]{10,}/g,
  // OpenAI / OpenRouter: sk-* (OpenRouter adds "or" prefix)
  /sk-[a-zA-Z0-9]{20,}/g,
  // Google: AIza*
  /AIza[a-zA-Z0-9_-]{30,}/g,
  // GitHub PAT (classic): ghp_*
  /ghp_[a-zA-Z0-9]{30,}/g,
  // GitHub PAT (fine-grained): github_pat_*
  /github_pat_[a-zA-Z0-9_]{30,}/g,
  // Groq: gsk_*
  /gsk_[a-zA-Z0-9]{20,}/g,
  // OpenRouter explicit prefix: sk-or-*
  /\bsk-or-[a-zA-Z0-9_-]{20,}\b/g,
  // GitHub OAuth / App tokens: gho_*, ghs_*
  /gh[os]_[a-zA-Z0-9]{30,}/g,
  // Generic bearer-style tokens (40+ hex chars) — last resort
  /\b[a-f0-9]{40,}\b/g
];
function sanitizeErrorMessage(message) {
  let sanitized = message;
  for (const pattern of API_KEY_PATTERNS) {
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, "[REDACTED_KEY]");
  }
  return sanitized;
}

// src/adapters/cli-utils.ts
var DEFAULT_CLI_TIMEOUT = 12e4;
var DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;
async function isCliAvailableAsync(command, args = ["--version"], timeout = 5e3) {
  try {
    await new Promise((resolve2, reject) => {
      const child = execFile(command, args, { timeout });
      child.on("close", (code) => {
        if (code === 0) resolve2();
        else reject(new Error(`Exit code ${code}`));
      });
      child.on("error", reject);
    });
    return true;
  } catch {
    return false;
  }
}
function execCliSync(command, args, options = {}) {
  const { input, timeout = DEFAULT_CLI_TIMEOUT, maxBuffer = DEFAULT_MAX_BUFFER, env } = options;
  return execFileSync(command, args, {
    input,
    timeout,
    maxBuffer,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: env ?? process.env
  });
}

// src/adapters/cli-opencode.ts
function parseOpenCodeOutput(raw) {
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const textParts = [];
  let tokens;
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event["type"] === "text") {
        const part = event["part"];
        if (part?.["text"]) {
          textParts.push(part["text"]);
        }
      } else if (event["type"] === "step_finish") {
        const part = event["part"];
        if (part?.["tokens"]) {
          tokens = part["tokens"];
        }
      }
    } catch {
    }
  }
  return { text: textParts.join(""), tokens };
}
var CliOpenCodeAdapter = class {
  id = "opencode-cli";
  name = "OpenCode CLI";
  type = "cli";
  models = [
    // Free tier (opencode/*)
    { id: "opencode/big-pickle", name: "Big Pickle", provider: "opencode-cli", maxTokens: 8192 },
    { id: "opencode/gpt-5-nano", name: "GPT-5 Nano", provider: "opencode-cli", maxTokens: 8192 },
    { id: "opencode/mimo-v2-omni-free", name: "MIMO v2 Omni Free", provider: "opencode-cli", maxTokens: 8192 },
    { id: "opencode/mimo-v2-pro-free", name: "MIMO v2 Pro Free", provider: "opencode-cli", maxTokens: 8192 },
    { id: "opencode/minimax-m2.5-free", name: "MiniMax M2.5 Free", provider: "opencode-cli", maxTokens: 8192 },
    { id: "opencode/nemotron-3-super-free", name: "Nemotron 3 Super Free", provider: "opencode-cli", maxTokens: 8192 },
    // OpenCode Go (subscription)
    { id: "opencode-go/glm-5", name: "GLM-5", provider: "opencode-cli", maxTokens: 8192 },
    { id: "opencode-go/kimi-k2.5", name: "Kimi K2.5", provider: "opencode-cli", maxTokens: 8192 },
    { id: "opencode-go/minimax-m2.5", name: "MiniMax M2.5", provider: "opencode-cli", maxTokens: 8192 },
    { id: "opencode-go/minimax-m2.7", name: "MiniMax M2.7", provider: "opencode-cli", maxTokens: 8192 },
    // Anthropic via OpenCode
    { id: "anthropic/claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-3-5-haiku-latest", name: "Claude 3.5 Haiku Latest", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-3-5-sonnet-20240620", name: "Claude 3.5 Sonnet (Jun)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet (Oct)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-3-7-sonnet-latest", name: "Claude 3.7 Sonnet Latest", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-3-haiku-20240307", name: "Claude 3 Haiku", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-3-opus-20240229", name: "Claude 3 Opus", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-3-sonnet-20240229", name: "Claude 3 Sonnet", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-haiku-4-5-20251001", name: "Claude Haiku 4.5 (Oct)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-opus-4-0", name: "Claude Opus 4.0", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-opus-4-1", name: "Claude Opus 4.1", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-opus-4-1-20250805", name: "Claude Opus 4.1 (Aug)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-opus-4-20250514", name: "Claude Opus 4 (May)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-opus-4-5", name: "Claude Opus 4.5", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-opus-4-5-20251101", name: "Claude Opus 4.5 (Nov)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-opus-4-6", name: "Claude Opus 4.6", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-sonnet-4-0", name: "Claude Sonnet 4.0", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4 (May)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5 (Sep)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "opencode-cli", maxTokens: 8192 },
    // GitHub Copilot via OpenCode
    { id: "github-copilot/claude-haiku-4.5", name: "Claude Haiku 4.5 (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/claude-opus-4.5", name: "Claude Opus 4.5 (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/claude-opus-4.6", name: "Claude Opus 4.6 (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/claude-opus-41", name: "Claude Opus 4.1 (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/claude-sonnet-4", name: "Claude Sonnet 4 (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/claude-sonnet-4.5", name: "Claude Sonnet 4.5 (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/claude-sonnet-4.6", name: "Claude Sonnet 4.6 (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/gemini-2.5-pro", name: "Gemini 2.5 Pro (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/gemini-3-flash-preview", name: "Gemini 3 Flash (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/gemini-3-pro-preview", name: "Gemini 3 Pro (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/gpt-4.1", name: "GPT-4.1 (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/gpt-4o", name: "GPT-4o (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/gpt-5", name: "GPT-5 (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/gpt-5-mini", name: "GPT-5 Mini (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/gpt-5.1", name: "GPT-5.1 (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/gpt-5.1-codex", name: "GPT-5.1 Codex (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/gpt-5.1-codex-max", name: "GPT-5.1 Codex Max (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/gpt-5.2", name: "GPT-5.2 (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/gpt-5.2-codex", name: "GPT-5.2 Codex (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/gpt-5.3-codex", name: "GPT-5.3 Codex (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/gpt-5.4", name: "GPT-5.4 (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/gpt-5.4-mini", name: "GPT-5.4 Mini (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    { id: "github-copilot/grok-code-fast-1", name: "Grok Code Fast 1 (Copilot)", provider: "opencode-cli", maxTokens: 8192 },
    // OpenAI via OpenCode
    { id: "openai/codex-mini-latest", name: "Codex Mini Latest", provider: "opencode-cli", maxTokens: 8192 },
    { id: "openai/gpt-5-codex", name: "GPT-5 Codex", provider: "opencode-cli", maxTokens: 8192 },
    { id: "openai/gpt-5.1-codex", name: "GPT-5.1 Codex", provider: "opencode-cli", maxTokens: 8192 },
    { id: "openai/gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", provider: "opencode-cli", maxTokens: 8192 },
    { id: "openai/gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini", provider: "opencode-cli", maxTokens: 8192 },
    { id: "openai/gpt-5.2", name: "GPT-5.2", provider: "opencode-cli", maxTokens: 8192 },
    { id: "openai/gpt-5.2-codex", name: "GPT-5.2 Codex", provider: "opencode-cli", maxTokens: 8192 },
    { id: "openai/gpt-5.3-codex", name: "GPT-5.3 Codex", provider: "opencode-cli", maxTokens: 8192 },
    { id: "openai/gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark", provider: "opencode-cli", maxTokens: 8192 },
    { id: "openai/gpt-5.4", name: "GPT-5.4", provider: "opencode-cli", maxTokens: 8192 }
  ];
  vault;
  constructor(vault2) {
    this.vault = vault2;
  }
  async generate(request) {
    const model = request.model ?? "opencode/gpt-5-nano";
    const authContent = this.vault.getFile("opencode", "auth.json", request.project);
    const tempBase = `/tmp/opencode-auth-${process.pid}-${Date.now()}`;
    const authDir = join2(tempBase, "opencode");
    try {
      const env = { ...process.env };
      if (authContent) {
        mkdirSync2(authDir, { recursive: true, mode: 448 });
        writeFileSync2(join2(authDir, "auth.json"), authContent, { mode: 384 });
        env["XDG_DATA_HOME"] = tempBase;
      }
      const args = ["run", "--model", model, "--format", "json"];
      const fullPrompt = request.system ? `${request.system}

---

${request.prompt}` : request.prompt;
      const output = execCliSync("opencode", args, {
        input: fullPrompt,
        env
      });
      const parsed = parseOpenCodeOutput(output);
      const totalTokens = parsed.tokens ? (parsed.tokens.input ?? 0) + (parsed.tokens.output ?? 0) : 0;
      return {
        text: parsed.text || output.trim(),
        provider: this.id,
        model,
        tokensUsed: totalTokens,
        resolvedProvider: this.id,
        resolvedModel: model,
        fallbackUsed: false
      };
    } catch (error) {
      const execError = error;
      if (execError.stdout) {
        const parsed = parseOpenCodeOutput(execError.stdout);
        if (parsed.text) {
          return {
            text: parsed.text,
            provider: this.id,
            model,
            tokensUsed: 0,
            resolvedProvider: this.id,
            resolvedModel: model,
            fallbackUsed: false
          };
        }
      }
      throw new Error(
        `OpenCode CLI failed: ${execError.message ?? String(error)}`
      );
    } finally {
      if (existsSync(tempBase)) {
        rmSync2(tempBase, { recursive: true, force: true });
      }
    }
  }
  async isAvailable() {
    return isCliAvailableAsync("opencode");
  }
};

// src/adapters/base-cli-adapter.ts
var BaseCliAdapter = class {
  vault;
  constructor(vault2) {
    this.vault = vault2;
  }
  get id() {
    return this.config.id;
  }
  get name() {
    return this.config.name;
  }
  get type() {
    return "cli";
  }
  get models() {
    return this.config.models;
  }
  /**
   * Check if provider files are valid for this provider.
   * Override to add validation.
   */
  validateProviderFiles(_files) {
  }
  async generate(request) {
    const model = request.model ?? this.config.defaultModel;
    const providerFiles = this.vault.getProviderFiles(this.config.cliCommand, request.project);
    if (providerFiles.length > 0) {
      this.validateProviderFiles(providerFiles);
    }
    const mount = providerFiles.length > 0 ? materializeProviderHome(this.config.cliCommand, providerFiles, request.project) : null;
    try {
      const env = { ...process.env };
      if (mount) {
        env["HOME"] = mount.homeDir;
      }
      const prompt = request.system && this.config.supportsSystemPrompt ? request.prompt : request.system ? `${request.system}

${request.prompt}` : request.prompt;
      const args = this.buildArgs(model, prompt, request.system);
      const output = execCliSync(this.config.cliCommand, args, { env });
      const text = this.parseResponse(output);
      return {
        text,
        provider: this.id,
        model,
        tokensUsed: 0,
        resolvedProvider: this.id,
        resolvedModel: model,
        fallbackUsed: false
      };
    } catch (error) {
      const execError = error;
      if (execError.stdout) {
        try {
          const text = this.parseResponse(execError.stdout);
          if (text) {
            return { text, provider: this.id, model, tokensUsed: 0, resolvedProvider: this.id, resolvedModel: model, fallbackUsed: false };
          }
        } catch {
        }
      }
      throw new Error(
        sanitizeErrorMessage(`${this.config.name} CLI failed: ${execError.message ?? String(error)}`)
      );
    } finally {
      mount?.cleanup();
    }
  }
  async isAvailable() {
    return isCliAvailableAsync(this.config.cliCommand);
  }
};

// src/adapters/cli-claude.ts
var CLAUDE_CONFIG = {
  id: "claude-cli",
  name: "Claude CLI",
  cliCommand: "claude",
  defaultModel: "claude-sonnet-4-5",
  supportsSystemPrompt: true,
  models: [
    { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5 (Max)", provider: "claude-cli", maxTokens: 8192 },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6 (Max)", provider: "claude-cli", maxTokens: 8192 },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Max)", provider: "claude-cli", maxTokens: 8192 },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (Max)", provider: "claude-cli", maxTokens: 8192 }
  ]
};
var ClaudeCliAdapter = class extends BaseCliAdapter {
  config = CLAUDE_CONFIG;
  constructor(vault2) {
    super(vault2);
  }
  buildArgs(model, prompt, system) {
    const args = ["-p", JSON.stringify(prompt), "--output-format", "json", "--max-turns", "1", "--model", model];
    if (system) {
      args.push("--system-prompt", JSON.stringify(system));
    }
    return args;
  }
  parseResponse(output) {
    const parsed = JSON.parse(output);
    const content = parsed["content"];
    const firstContent = Array.isArray(content) ? content[0] : void 0;
    return parsed["result"] ?? firstContent?.["text"] ?? output;
  }
};

// src/adapters/cli-gemini.ts
var GEMINI_CONFIG = {
  id: "gemini-cli",
  name: "Gemini CLI",
  cliCommand: "gemini",
  defaultModel: "gemini-2.5-flash",
  supportsSystemPrompt: false,
  models: [
    // Gemini 3 series
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", provider: "gemini-cli", maxTokens: 1024e3 },
    { id: "gemini-3.1-flash", name: "Gemini 3.1 Flash", provider: "gemini-cli", maxTokens: 1024e3 },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite", provider: "gemini-cli", maxTokens: 1024e3 },
    { id: "gemini-3-pro-preview", name: "Gemini 3 Pro (Preview)", provider: "gemini-cli", maxTokens: 1024e3 },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash (Preview)", provider: "gemini-cli", maxTokens: 1024e3 },
    // Gemini 2.5 series
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "gemini-cli", maxTokens: 1024e3 },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "gemini-cli", maxTokens: 1024e3 },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite", provider: "gemini-cli", maxTokens: 1024e3 }
  ]
};
var GeminiCliAdapter = class extends BaseCliAdapter {
  config = GEMINI_CONFIG;
  constructor(vault2) {
    super(vault2);
  }
  buildArgs(model, prompt) {
    return ["-p", JSON.stringify(prompt), "--output-format", "json", "--model", model];
  }
  parseResponse(output) {
    const parsed = JSON.parse(output);
    return parsed["response"] ?? output;
  }
  validateProviderFiles(files) {
    const hasSettings = files.some((file) => file.fileName === "settings.json");
    const hasOauthCreds = files.some((file) => file.fileName === "oauth_creds.json");
    if (!hasSettings || !hasOauthCreds) {
      throw new Error("Gemini CLI auth incomplete: upload settings.json and oauth_creds.json");
    }
  }
};

// src/adapters/cli-codex.ts
var CODEX_CONFIG = {
  id: "codex-cli",
  name: "Codex CLI",
  cliCommand: "codex",
  defaultModel: "gpt-5.4",
  supportsSystemPrompt: false,
  models: [
    { id: "gpt-5.4", name: "GPT-5.4", provider: "codex-cli", maxTokens: 8192 },
    { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", provider: "codex-cli", maxTokens: 8192 },
    { id: "gpt-5.1-codex", name: "GPT-5.1 Codex", provider: "codex-cli", maxTokens: 8192 }
  ]
};
var CodexCliAdapter = class extends BaseCliAdapter {
  config = CODEX_CONFIG;
  constructor(vault2) {
    super(vault2);
  }
  buildArgs(model, prompt) {
    return ["exec", "--model", model, JSON.stringify(prompt)];
  }
  parseResponse(output) {
    return output.trim();
  }
};

// src/adapters/cli-qwen.ts
var QWEN_CONFIG = {
  id: "qwen-cli",
  name: "Qwen CLI",
  cliCommand: "qwen",
  defaultModel: "qwen3-coder-plus",
  supportsSystemPrompt: false,
  models: [
    { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus", provider: "qwen-cli", maxTokens: 8192 },
    { id: "qwen-plus", name: "Qwen Plus", provider: "qwen-cli", maxTokens: 8192 },
    { id: "qwen-max", name: "Qwen Max", provider: "qwen-cli", maxTokens: 8192 },
    { id: "qwen-turbo", name: "Qwen Turbo", provider: "qwen-cli", maxTokens: 8192 }
  ]
};
var QwenCliAdapter = class extends BaseCliAdapter {
  config = QWEN_CONFIG;
  constructor(vault2) {
    super(vault2);
  }
  buildArgs(model, prompt) {
    return ["-p", JSON.stringify(prompt), "--model", model];
  }
  parseResponse(output) {
    try {
      const parsed = JSON.parse(output);
      return parsed["response"] ?? parsed["result"] ?? output;
    } catch {
      return output.trim();
    }
  }
  validateProviderFiles(files) {
    const hasSettings = files.some((file) => file.fileName === "settings.json");
    const hasOauthCreds = files.some((file) => file.fileName === "oauth_creds.json");
    if (!hasSettings || !hasOauthCreds) {
      throw new Error("Qwen CLI auth incomplete: upload settings.json and oauth_creds.json");
    }
  }
};

// src/adapters/cli-copilot.ts
var CopilotCliAdapter = class {
  id = "copilot-cli";
  name = "Copilot CLI";
  type = "cli";
  models = [
    { id: "gpt-4.1", name: "GPT-4.1 (Copilot)", provider: "copilot-cli", maxTokens: 8192 },
    { id: "gpt-5-mini", name: "GPT-5 Mini (Copilot)", provider: "copilot-cli", maxTokens: 8192 },
    { id: "gpt-5.1", name: "GPT-5.1 (Copilot)", provider: "copilot-cli", maxTokens: 8192 },
    { id: "gpt-5.1-codex", name: "GPT-5.1 Codex (Copilot)", provider: "copilot-cli", maxTokens: 8192 },
    { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max (Copilot)", provider: "copilot-cli", maxTokens: 8192 },
    { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini (Copilot)", provider: "copilot-cli", maxTokens: 8192 },
    { id: "gpt-5.2", name: "GPT-5.2 (Copilot)", provider: "copilot-cli", maxTokens: 8192 },
    { id: "gpt-5.2-codex", name: "GPT-5.2 Codex (Copilot)", provider: "copilot-cli", maxTokens: 8192 },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex (Copilot)", provider: "copilot-cli", maxTokens: 8192 },
    { id: "gpt-5.4", name: "GPT-5.4 (Copilot)", provider: "copilot-cli", maxTokens: 8192 },
    { id: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview (Copilot)", provider: "copilot-cli", maxTokens: 8192 },
    { id: "claude-sonnet-4", name: "Claude Sonnet 4 (Copilot)", provider: "copilot-cli", maxTokens: 8192 },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5 (Copilot)", provider: "copilot-cli", maxTokens: 8192 },
    { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6 (Copilot)", provider: "copilot-cli", maxTokens: 8192 },
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5 (Copilot)", provider: "copilot-cli", maxTokens: 8192 },
    { id: "claude-opus-4.5", name: "Claude Opus 4.5 (Copilot)", provider: "copilot-cli", maxTokens: 8192 },
    { id: "claude-opus-4.6", name: "Claude Opus 4.6 (Copilot)", provider: "copilot-cli", maxTokens: 8192 },
    { id: "claude-opus-4.6-fast", name: "Claude Opus 4.6 Fast (Copilot)", provider: "copilot-cli", maxTokens: 8192 }
  ];
  vault;
  constructor(vault2) {
    this.vault = vault2;
  }
  async generate(request) {
    const model = request.model ?? "gpt-4.1";
    const fullPrompt = request.system ? `${request.system}

${request.prompt}` : request.prompt;
    const env = { ...process.env };
    try {
      const token = this.vault.getDecrypted("copilot", "default", request.project);
      env["COPILOT_GITHUB_TOKEN"] = token;
      env["GH_TOKEN"] = token;
      env["GITHUB_TOKEN"] = token;
    } catch {
    }
    const output = execCliSync("copilot", ["-p", JSON.stringify(fullPrompt), "--model", model, "--allow-all-tools"], { env });
    return { text: output.trim(), provider: this.id, model, tokensUsed: 0, resolvedProvider: this.id, resolvedModel: model, fallbackUsed: false };
  }
  async isAvailable() {
    return isCliAvailableAsync("copilot");
  }
};

// src/adapters/index.ts
function createAllAdapters(vault2) {
  return [
    new AnthropicAdapter(vault2),
    new OpenAIAdapter(vault2),
    new GoogleAdapter(vault2),
    new GroqAdapter(vault2),
    new OpenRouterAdapter(vault2),
    new CliOpenCodeAdapter(vault2),
    new ClaudeCliAdapter(vault2),
    new GeminiCliAdapter(vault2),
    new CodexCliAdapter(vault2),
    new QwenCliAdapter(vault2),
    new CopilotCliAdapter(vault2)
  ];
}

// src/bridge/classifier.ts
var DEFAULT_CODE_REVIEW_KEYWORDS = [
  "review",
  "audit",
  "analyze",
  "refactor",
  "code quality",
  "security review",
  "pull request",
  "pr review",
  "code review",
  "inspect"
];
var DEFAULT_CONFIG = {
  largeContextThreshold: 1e5,
  fastCompletionMaxLength: 500,
  codeReviewKeywords: DEFAULT_CODE_REVIEW_KEYWORDS
};
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
function classify(prompt, config2) {
  const cfg = {
    ...DEFAULT_CONFIG,
    ...config2
  };
  const tokens = estimateTokens(prompt);
  if (tokens > cfg.largeContextThreshold) {
    return "large-context";
  }
  const lowerPrompt = prompt.toLowerCase();
  const hasCodeReviewKeyword = cfg.codeReviewKeywords.some(
    (keyword) => lowerPrompt.includes(keyword.toLowerCase())
  );
  if (hasCodeReviewKeyword) {
    return "code-review";
  }
  if (prompt.length < cfg.fastCompletionMaxLength) {
    return "fast-completion";
  }
  return "default";
}

// src/bridge/orchestrator.ts
var BridgeOrchestrator = class {
  constructor(router2, config2) {
    this.router = router2;
    this.config = config2;
  }
  /**
   * Generate text with task-aware routing.
   *
   * Classifies the prompt, picks the best provider, and falls back
   * through the configured chain on failure.
   */
  async generate(request) {
    const startTime = Date.now();
    const taskType = classify(request.prompt);
    const preferredProvider = this.config.routes.get(taskType) ?? this.config.default;
    logger.info(
      { taskType, preferredProvider, prompt: request.prompt.slice(0, 80) },
      "Bridge: classified request"
    );
    const providerOrder = this.buildProviderOrder(preferredProvider);
    const errors = [];
    for (const [index, providerId] of providerOrder.entries()) {
      try {
        const result = await this.router.generate({
          ...request,
          provider: providerId
        });
        const latencyMs = Date.now() - startTime;
        const fallbackUsed = index > 0;
        if (fallbackUsed) {
          logger.info(
            { taskType, preferredProvider, actualProvider: providerId },
            "Bridge: used fallback provider"
          );
        }
        return {
          text: result.text,
          provider: result.provider,
          model: result.model,
          taskType,
          fallbackUsed,
          latencyMs
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          { provider: providerId, error: message },
          "Bridge: provider failed, trying next"
        );
        errors.push(`${providerId}: ${message}`);
        continue;
      }
    }
    throw new Error(
      `Bridge: all providers failed for task type "${taskType}".
${errors.join("\n")}`
    );
  }
  /**
   * Build the ordered provider list for fallback chain.
   *
   * Puts the preferred provider first, then appends fallback_order
   * entries that aren't already in the list (deduplication).
   */
  buildProviderOrder(preferredProvider) {
    const order = [preferredProvider];
    const seen = /* @__PURE__ */ new Set([preferredProvider]);
    for (const provider of this.config.fallbackOrder) {
      if (!seen.has(provider)) {
        order.push(provider);
        seen.add(provider);
      }
    }
    return order;
  }
};

// src/bridge/config.ts
import { existsSync as existsSync2, readFileSync } from "fs";
import { join as join3 } from "path";
import { homedir } from "os";
var VALID_TASK_TYPES = /* @__PURE__ */ new Set(["large-context", "code-review", "fast-completion", "default"]);
var BRIDGE_CONFIG_PATH = join3(homedir(), ".llm-gateway", "bridge.yaml");
function parseSimpleYaml(content) {
  const result = {};
  const lines = content.split("\n");
  let currentSection = null;
  let arrayKey = null;
  const arrayValues = [];
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const stripped = line.replace(/#.*$/, "").trimEnd();
    if (!stripped || stripped.trim() === "") continue;
    const arrayMatch = stripped.match(/^\s+-\s+(.+)$/);
    if (arrayMatch && arrayKey) {
      arrayValues.push(arrayMatch[1].trim());
      continue;
    }
    if (arrayKey && arrayValues.length > 0) {
      if (arrayKey === "fallback_order") {
        result.fallback_order = [...arrayValues];
      }
      arrayValues.length = 0;
      arrayKey = null;
    }
    const indent = stripped.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (indent === 0) {
      const sectionMatch = stripped.match(/^(\w[\w_]*):\s*$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1];
        if (currentSection === "fallback_order") {
          arrayKey = "fallback_order";
        }
        continue;
      }
      const topLevelMatch = stripped.match(/^(\w[\w_]*):\s+(.+)$/);
      if (topLevelMatch) {
        currentSection = null;
        const [, key, value] = topLevelMatch;
        if (key === "default") {
          result.default = value.trim();
        }
        if (key === "fallback_order") {
          const inlineMatch = value.match(/^\[(.+)]$/);
          if (inlineMatch) {
            result.fallback_order = inlineMatch[1].split(",").map((s) => s.trim());
          }
        }
        continue;
      }
    }
    const nestedMatch = stripped.match(/^\s+(\S+):\s+(.+)$/);
    if (nestedMatch && currentSection === "routes") {
      if (!result.routes) result.routes = {};
      result.routes[nestedMatch[1].trim()] = nestedMatch[2].trim();
      continue;
    }
  }
  if (arrayKey === "fallback_order" && arrayValues.length > 0) {
    result.fallback_order = [...arrayValues];
  }
  return result;
}
function validateConfig(raw) {
  if (!raw.default) {
    logger.warn('Bridge config missing "default" provider');
    return null;
  }
  if (!raw.fallback_order || raw.fallback_order.length === 0) {
    logger.warn('Bridge config missing "fallback_order"');
    return null;
  }
  const routes = /* @__PURE__ */ new Map();
  if (raw.routes) {
    for (const [taskType, provider] of Object.entries(raw.routes)) {
      if (!VALID_TASK_TYPES.has(taskType)) {
        logger.warn({ taskType }, "Bridge config: unknown task type in routes, skipping");
        continue;
      }
      routes.set(taskType, provider);
    }
  }
  return {
    routes,
    default: raw.default,
    fallbackOrder: raw.fallback_order
  };
}
function loadBridgeConfig(configPath) {
  const path = configPath ?? BRIDGE_CONFIG_PATH;
  if (!existsSync2(path)) {
    return null;
  }
  try {
    const content = readFileSync(path, "utf8");
    const raw = parseSimpleYaml(content);
    const config2 = validateConfig(raw);
    if (config2) {
      logger.info(
        { routes: config2.routes.size, fallbackOrder: config2.fallbackOrder },
        "Bridge config loaded"
      );
    }
    return config2;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "Failed to load bridge config");
    return null;
  }
}

// src/code-search/searcher.ts
import { readdirSync, readFileSync as readFileSync3, statSync } from "fs";
import { join as join4, extname as extname2, relative } from "path";

// src/code-search/chunker.ts
var TS_PATTERNS = [
  // Export/async function declarations
  { kind: "function", pattern: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m },
  // Arrow function assigned to const/let/var
  { kind: "function", pattern: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/m },
  // Class declarations
  { kind: "class", pattern: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/m },
  // Interface declarations
  { kind: "interface", pattern: /^(?:export\s+)?interface\s+(\w+)/m },
  // Type alias declarations
  { kind: "type", pattern: /^(?:export\s+)?type\s+(\w+)\s*=/m }
];
var PY_PATTERNS = [
  { kind: "function", pattern: /^(?:async\s+)?def\s+(\w+)/m },
  { kind: "class", pattern: /^class\s+(\w+)/m }
];
var GO_PATTERNS = [
  { kind: "function", pattern: /^func\s+(?:\([^)]+\)\s+)?(\w+)/m },
  { kind: "type", pattern: /^type\s+(\w+)\s+(?:struct|interface)/m }
];
var RUST_PATTERNS = [
  { kind: "function", pattern: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/m },
  { kind: "type", pattern: /^(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/m }
];
function getPatternsForFile(filePath) {
  if (/\.[jt]sx?$|\.mjs$|\.cjs$/.test(filePath)) return TS_PATTERNS;
  if (/\.py$/.test(filePath)) return PY_PATTERNS;
  if (/\.go$/.test(filePath)) return GO_PATTERNS;
  if (/\.rs$/.test(filePath)) return RUST_PATTERNS;
  return TS_PATTERNS;
}
function findBlockEnd(content, startIdx) {
  let depth = 0;
  let inString = null;
  let escaped = false;
  for (let i = startIdx; i < content.length; i++) {
    const ch = content[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (!inString && (ch === '"' || ch === "'" || ch === "`")) {
      inString = ch;
      continue;
    }
    if (inString === ch) {
      inString = null;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return content.length - 1;
}
function findIndentBlockEnd(lines, startLineIdx) {
  const startLine = lines[startLineIdx];
  if (!startLine) return startLineIdx;
  const baseIndent = startLine.search(/\S/);
  for (let i = startLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = line.search(/\S/);
    if (indent <= baseIndent) {
      let end2 = i - 1;
      while (end2 > startLineIdx && lines[end2].trim() === "") end2--;
      return end2;
    }
  }
  let end = lines.length - 1;
  while (end > startLineIdx && lines[end].trim() === "") end--;
  return end;
}
function splitIntoChunks(filePath, content) {
  const patterns = getPatternsForFile(filePath);
  const lines = content.split("\n");
  const chunks = [];
  const seen = /* @__PURE__ */ new Set();
  const isPython = /\.py$/.test(filePath);
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    for (const { kind, pattern } of patterns) {
      const match = pattern.exec(line);
      if (!match) continue;
      const name = match[1] ?? "anonymous";
      let endLineIdx;
      if (isPython) {
        endLineIdx = findIndentBlockEnd(lines, lineIdx);
      } else {
        const lineOffset = lines.slice(0, lineIdx).join("\n").length + (lineIdx > 0 ? 1 : 0);
        const braceIdx = content.indexOf("{", lineOffset);
        if (braceIdx === -1) {
          endLineIdx = lineIdx;
          for (let j = lineIdx; j < lines.length; j++) {
            if (lines[j].includes(";") || lines[j].trimEnd().endsWith(",")) {
              endLineIdx = j;
              break;
            }
            if (j > lineIdx && lines[j].match(/^(?:export|const|let|var|function|class|interface|type|import)\b/)) {
              endLineIdx = j - 1;
              break;
            }
            endLineIdx = j;
          }
        } else {
          const endIdx = findBlockEnd(content, braceIdx);
          endLineIdx = content.substring(0, endIdx + 1).split("\n").length - 1;
        }
      }
      endLineIdx = Math.min(endLineIdx, lines.length - 1);
      const chunkContent = lines.slice(lineIdx, endLineIdx + 1).join("\n");
      const id = `${filePath}:${lineIdx + 1}`;
      if (!seen.has(id)) {
        seen.add(id);
        chunks.push({
          id,
          filePath,
          name,
          kind,
          content: chunkContent,
          startLine: lineIdx + 1,
          endLine: endLineIdx + 1
        });
      }
      break;
    }
  }
  return chunks;
}

// src/code-search/indexer.ts
function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9_]/g, " ").split(/\s+/).filter((t) => t.length > 1);
}
function trigrams(text) {
  const padded = `  ${text.toLowerCase()}  `;
  const grams = /* @__PURE__ */ new Set();
  for (let i = 0; i <= padded.length - 3; i++) {
    grams.add(padded.substring(i, i + 3));
  }
  return grams;
}
function trigramSimilarity(a, b) {
  let intersection = 0;
  for (const g of a) {
    if (b.has(g)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
var SearchIndex = class {
  /** All indexed chunks. */
  chunks = [];
  /** Inverted index: token → set of chunk indices. */
  invertedIndex = /* @__PURE__ */ new Map();
  /** Pre-computed trigrams for each chunk's name. */
  nameTrigrams = [];
  /** Number of indexed chunks. */
  get size() {
    return this.chunks.length;
  }
  /** Clear the entire index. */
  clear() {
    this.chunks = [];
    this.invertedIndex.clear();
    this.nameTrigrams = [];
  }
  /**
   * Add chunks to the index.
   * Tokenizes names and content for keyword search,
   * and pre-computes trigrams for fuzzy matching.
   */
  addChunks(chunks) {
    for (const chunk of chunks) {
      const idx = this.chunks.length;
      this.chunks.push(chunk);
      const nameTokens = tokenize(chunk.name);
      for (const token of nameTokens) {
        let set = this.invertedIndex.get(token);
        if (!set) {
          set = /* @__PURE__ */ new Set();
          this.invertedIndex.set(token, set);
        }
        set.add(idx);
      }
      const contentTokens = tokenize(chunk.content);
      for (const token of contentTokens) {
        let set = this.invertedIndex.get(token);
        if (!set) {
          set = /* @__PURE__ */ new Set();
          this.invertedIndex.set(token, set);
        }
        set.add(idx);
      }
      this.nameTrigrams.push({
        idx,
        grams: trigrams(chunk.name),
        name: chunk.name.toLowerCase()
      });
    }
  }
  /**
   * Search the index with keyword + fuzzy matching.
   *
   * Scoring:
   * - Exact name match: 1.0
   * - Name prefix match: 0.8
   * - Keyword in content: 0.5 per token hit
   * - Fuzzy name match: similarity * 0.6
   *
   * @param query - Search query string.
   * @param limit - Max results to return.
   * @returns Ranked search results.
   */
  search(query, limit) {
    if (this.chunks.length === 0) return [];
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];
    const scores = /* @__PURE__ */ new Map();
    const queryLower = query.toLowerCase().trim();
    const queryGrams = trigrams(queryLower);
    for (const { idx, name } of this.nameTrigrams) {
      if (name === queryLower) {
        scores.set(idx, (scores.get(idx) ?? 0) + 1);
      } else if (name.startsWith(queryLower) || queryLower.startsWith(name)) {
        scores.set(idx, (scores.get(idx) ?? 0) + 0.8);
      }
    }
    for (const token of queryTokens) {
      const matching = this.invertedIndex.get(token);
      if (matching) {
        for (const idx of matching) {
          const chunk = this.chunks[idx];
          const nameTokens = tokenize(chunk.name);
          const isNameMatch = nameTokens.includes(token);
          const bonus = isNameMatch ? 0.6 : 0.3;
          scores.set(idx, (scores.get(idx) ?? 0) + bonus);
        }
      }
    }
    for (const { idx, grams } of this.nameTrigrams) {
      const sim = trigramSimilarity(queryGrams, grams);
      if (sim > 0.3) {
        scores.set(idx, (scores.get(idx) ?? 0) + sim * 0.6);
      }
    }
    const ranked = [];
    for (const [idx, score] of scores) {
      ranked.push({ chunk: this.chunks[idx], score });
    }
    ranked.sort((a, b) => b.score - a.score);
    const maxScore = ranked[0]?.score ?? 1;
    return ranked.slice(0, limit).map(({ chunk, score }) => ({
      filePath: chunk.filePath,
      name: chunk.name,
      kind: chunk.kind,
      content: chunk.content,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      score: Math.min(1, score / maxScore)
    }));
  }
  /** Get a chunk by its ID. */
  getChunk(id) {
    return this.chunks.find((c) => c.id === id);
  }
  /** Get all chunks for a specific file. */
  getChunksForFile(filePath) {
    return this.chunks.filter((c) => c.filePath === filePath);
  }
};

// src/code-search/multi-hop.ts
import { readFileSync as readFileSync2, existsSync as existsSync3 } from "fs";
import { resolve, dirname as dirname2, extname } from "path";

// src/code-search/types.ts
var DEFAULT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".lua"
];
var DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  "__pycache__",
  ".next",
  "coverage",
  ".nyc_output",
  "vendor",
  ".cache"
];
var DEFAULT_MAX_FILE_SIZE = 1e5;
var DEFAULT_LIMIT = 10;
var MAX_LIMIT = 50;

// src/code-search/multi-hop.ts
var IMPORT_PATTERNS = [
  {
    // ES named import: import { X, Y } from './path'
    regex: /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g,
    extract: (m) => ({
      specifier: m[2] ?? "",
      symbols: (m[1] ?? "").split(",").map((s) => s.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean)
    })
  },
  {
    // ES default import: import X from './path'
    regex: /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
    extract: (m) => ({
      specifier: m[2] ?? "",
      symbols: [m[1] ?? ""].filter(Boolean)
    })
  },
  {
    // ES star import: import * as X from './path'
    regex: /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
    extract: (m) => ({
      specifier: m[2] ?? "",
      symbols: [m[1] ?? ""].filter(Boolean)
    })
  },
  {
    // ES side-effect import: import './path'
    regex: /import\s+['"]([^'"]+)['"]/g,
    extract: (m) => ({
      specifier: m[1] ?? "",
      symbols: []
    })
  },
  {
    // CommonJS require: const { X } = require('./path') or const X = require('./path')
    regex: /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    extract: (m) => ({
      specifier: m[3] ?? "",
      symbols: (m[1] ?? m[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    })
  },
  {
    // Python: from module import X, Y
    regex: /from\s+(\S+)\s+import\s+(.+)/g,
    extract: (m) => ({
      specifier: m[1] ?? "",
      symbols: (m[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    })
  },
  {
    // Go import: import "package/path"
    regex: /import\s+(?:\w+\s+)?"([^"]+)"/g,
    extract: (m) => ({
      specifier: m[1] ?? "",
      symbols: []
    })
  }
];
function extractImports(filePath, content) {
  const imports = [];
  const dir = dirname2(filePath);
  const seen = /* @__PURE__ */ new Set();
  for (const { regex, extract } of IMPORT_PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    let match;
    while ((match = re.exec(content)) !== null) {
      const result = extract(match);
      if (!result) continue;
      const { specifier, symbols } = result;
      if (!specifier || seen.has(specifier)) continue;
      seen.add(specifier);
      const resolvedPath = resolveImportPath(specifier, dir);
      imports.push({ specifier, resolvedPath, symbols });
    }
  }
  return imports;
}
function resolveImportPath(specifier, fromDir) {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    return null;
  }
  const base = resolve(fromDir, specifier);
  if (extname(base)) {
    return existsSync3(base) ? base : null;
  }
  for (const ext of DEFAULT_EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync3(candidate)) return candidate;
  }
  for (const ext of DEFAULT_EXTENSIONS) {
    const candidate = resolve(base, `index${ext}`);
    if (existsSync3(candidate)) return candidate;
  }
  return null;
}
function findRelatedChunks(matchedChunks, index, maxDepth = 2) {
  const related = /* @__PURE__ */ new Map();
  const visitedFiles = /* @__PURE__ */ new Set();
  for (const chunk of matchedChunks) {
    const chunkId = `${chunk.filePath}:${chunk.startLine}`;
    const chunkRelated = [];
    followImports(chunk.filePath, index, chunkRelated, visitedFiles, 0, maxDepth);
    if (chunkRelated.length > 0) {
      related.set(chunkId, chunkRelated);
    }
  }
  return related;
}
function followImports(filePath, index, results, visited, depth, maxDepth) {
  if (depth >= maxDepth || visited.has(filePath)) return;
  visited.add(filePath);
  let content;
  try {
    content = readFileSync2(filePath, "utf-8");
  } catch {
    return;
  }
  const imports = extractImports(filePath, content);
  for (const imp of imports) {
    if (!imp.resolvedPath || visited.has(imp.resolvedPath)) continue;
    const chunks = index.getChunksForFile(imp.resolvedPath);
    if (chunks.length === 0) continue;
    if (imp.symbols.length > 0) {
      for (const chunk of chunks) {
        if (imp.symbols.some((s) => chunk.name === s)) {
          results.push({
            filePath: chunk.filePath,
            name: chunk.name,
            kind: chunk.kind,
            content: chunk.content,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            score: 0.5 / (depth + 1)
            // Decay score with depth
          });
        }
      }
    } else {
      for (const chunk of chunks.slice(0, 3)) {
        results.push({
          filePath: chunk.filePath,
          name: chunk.name,
          kind: chunk.kind,
          content: chunk.content,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          score: 0.3 / (depth + 1)
        });
      }
    }
    followImports(imp.resolvedPath, index, results, visited, depth + 1, maxDepth);
  }
}

// src/code-search/searcher.ts
var CodeSearchService = class {
  index = new SearchIndex();
  indexedScopes = /* @__PURE__ */ new Map();
  // scope → timestamp
  /** Get the current index size (number of chunks). */
  get indexSize() {
    return this.index.size;
  }
  /**
   * Index a codebase directory.
   *
   * Scans all matching files, chunks them, and builds the search index.
   * If the scope was already indexed within the last 5 minutes, skips re-indexing.
   *
   * @param opts - Indexing options.
   * @returns Number of chunks indexed.
   */
  indexDirectory(opts) {
    const {
      rootDir,
      ignorePatterns = DEFAULT_IGNORE,
      maxFileSize = DEFAULT_MAX_FILE_SIZE,
      extensions = DEFAULT_EXTENSIONS
    } = opts;
    const lastIndexed = this.indexedScopes.get(rootDir);
    if (lastIndexed && Date.now() - lastIndexed < 5 * 60 * 1e3) {
      logger.debug({ rootDir }, "Scope recently indexed, skipping");
      return this.index.size;
    }
    logger.info({ rootDir }, "Indexing codebase");
    const ignoreSet = new Set(ignorePatterns);
    const extSet = new Set(extensions);
    const files = this.collectFiles(rootDir, ignoreSet, extSet, maxFileSize);
    this.index.clear();
    let totalChunks = 0;
    for (const filePath of files) {
      try {
        const content = readFileSync3(filePath, "utf-8");
        const relPath = relative(rootDir, filePath);
        const chunks = splitIntoChunks(relPath, content);
        this.index.addChunks(chunks);
        totalChunks += chunks.length;
      } catch (err) {
        logger.warn({ filePath, error: err }, "Failed to chunk file");
      }
    }
    this.indexedScopes.set(rootDir, Date.now());
    logger.info({ rootDir, files: files.length, chunks: totalChunks }, "Indexing complete");
    return totalChunks;
  }
  /**
   * Search the indexed codebase.
   *
   * If no index exists for the scope, indexes it first.
   *
   * @param opts - Search options.
   * @returns Ranked search results.
   */
  search(opts) {
    const { query, scope, followImports: followImports2 = false } = opts;
    const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    if (!query.trim()) {
      return [];
    }
    if (scope && this.index.size === 0) {
      this.indexDirectory({ rootDir: scope });
    }
    const results = this.index.search(query, limit);
    if (followImports2 && results.length > 0) {
      const relatedMap = findRelatedChunks(results, this.index);
      for (const result of results) {
        const key = `${result.filePath}:${result.startLine}`;
        const related = relatedMap.get(key);
        if (related && related.length > 0) {
          result.related = related;
        }
      }
    }
    return results;
  }
  /**
   * Force re-index of a scope, ignoring the TTL cache.
   */
  reindex(rootDir) {
    this.indexedScopes.delete(rootDir);
    return this.indexDirectory({ rootDir });
  }
  /**
   * Recursively collect files matching the criteria.
   */
  collectFiles(dir, ignoreSet, extSet, maxFileSize) {
    const files = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (ignoreSet.has(entry.name)) continue;
        if (entry.name.startsWith(".")) continue;
        const fullPath = join4(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...this.collectFiles(fullPath, ignoreSet, extSet, maxFileSize));
        } else if (entry.isFile()) {
          const ext = extname2(entry.name);
          if (!extSet.has(ext)) continue;
          try {
            const stat = statSync(fullPath);
            if (stat.size > maxFileSize) continue;
            files.push(fullPath);
          } catch {
          }
        }
      }
    } catch {
    }
    return files;
  }
};

// src/comparison/persistence.ts
var ComparisonStore = class {
  constructor(db2) {
    this.db = db2;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS comparison_results (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        system_prompt TEXT,
        models TEXT NOT NULL,
        results TEXT NOT NULL,
        summary TEXT NOT NULL,
        project TEXT NOT NULL DEFAULT '${GLOBAL_PROJECT}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_comparison_project ON comparison_results(project);
      CREATE INDEX IF NOT EXISTS idx_comparison_created ON comparison_results(created_at);
    `);
    this.insertStmt = this.db.prepare(`
      INSERT INTO comparison_results (id, prompt, system_prompt, models, results, summary, project, created_at)
      VALUES (@id, @prompt, @systemPrompt, @models, @results, @summary, @project, @createdAt)
    `);
    this.getByIdStmt = this.db.prepare(
      "SELECT * FROM comparison_results WHERE id = ?"
    );
  }
  insertStmt;
  getByIdStmt;
  /**
   * Persist a comparison result.
   */
  save(result, systemPrompt, models, project) {
    this.insertStmt.run({
      id: result.id,
      prompt: result.prompt,
      systemPrompt: systemPrompt ?? null,
      models: JSON.stringify(models ?? result.results.map((r) => r.model)),
      results: JSON.stringify(result.results),
      summary: JSON.stringify(result.summary),
      project: project ?? GLOBAL_PROJECT,
      createdAt: result.createdAt
    });
  }
  /**
   * Retrieve a single comparison by ID.
   */
  getById(id) {
    const row = this.getByIdStmt.get(id);
    if (!row) return null;
    return this.mapRow(row);
  }
  /**
   * List comparisons with optional project filter and pagination.
   */
  query(filters = {}) {
    const conditions = [];
    const params = {};
    if (filters.project) {
      conditions.push("project = @project");
      params["project"] = filters.project;
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(filters.limit ?? 20, 100);
    const offset = filters.offset ?? 0;
    const sql = `
      SELECT * FROM comparison_results
      ${where}
      ORDER BY created_at DESC
      LIMIT @limit OFFSET @offset
    `;
    const rows = this.db.prepare(sql).all({ ...params, limit, offset });
    return rows.map((row) => this.mapRow(row));
  }
  /**
   * Map a database row to a CompareResponse.
   */
  mapRow(row) {
    return {
      id: row.id,
      prompt: row.prompt,
      results: JSON.parse(row.results),
      summary: JSON.parse(row.summary),
      createdAt: row.created_at
    };
  }
};

// src/comparison/service.ts
import { randomUUID } from "crypto";
var CostExceededError = class extends Error {
  constructor(estimatedCost, limit) {
    super(
      `Estimated cost $${estimatedCost.toFixed(4)} exceeds limit $${limit.toFixed(4)}`
    );
    this.estimatedCost = estimatedCost;
    this.limit = limit;
    this.name = "CostExceededError";
  }
};
function resolveMaxCostCeiling(options) {
  if (options?.maxCostCeiling !== void 0) return options.maxCostCeiling;
  const envVal = process.env["MAX_COMPARISON_COST_USD"];
  if (envVal) {
    const parsed = parseFloat(envVal);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 1;
}
var ComparisonService = class {
  router;
  freeModelRegistry;
  store;
  maxCostCeiling;
  defaultTimeoutMs;
  constructor(router2, options = {}) {
    this.router = router2;
    this.freeModelRegistry = options.freeModelRegistry;
    this.store = options.store;
    this.maxCostCeiling = resolveMaxCostCeiling(options);
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 3e4;
  }
  /**
   * Execute a multi-model comparison.
   *
   * 1. Pre-flight cost guard
   * 2. Fan-out via Promise.allSettled with per-model AbortController
   * 3. Enrich results (cost, latency, stability)
   * 4. Build summary
   * 5. Optionally persist
   */
  async compare(request) {
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const maxTokens = request.maxTokens ?? 1024;
    if (request.maxEstimatedCost !== void 0 || this.maxCostCeiling < Infinity) {
      const effectiveLimit = request.maxEstimatedCost !== void 0 ? Math.min(request.maxEstimatedCost, this.maxCostCeiling) : this.maxCostCeiling;
      const totalEstimate = this.estimateTotalCost(request.models, maxTokens);
      if (totalEstimate > effectiveLimit) {
        throw new CostExceededError(totalEstimate, effectiveLimit);
      }
    }
    const wallClockStart = Date.now();
    const promises = request.models.map(
      (model) => this.executeModel(model, request, maxTokens, timeoutMs)
    );
    const settled = await Promise.allSettled(promises);
    const wallClockMs = Date.now() - wallClockStart;
    const results = settled.map((outcome, index) => {
      const model = request.models[index];
      if (outcome.status === "fulfilled") {
        return outcome.value;
      }
      const error = outcome.reason instanceof Error ? outcome.reason : new Error(String(outcome.reason));
      const isTimeout = error.name === "AbortError" || error.message.includes("timed out");
      return {
        model,
        provider: "unknown",
        status: isTimeout ? "timeout" : "error",
        error: error.message,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: wallClockMs
      };
    });
    const summary = this.buildSummary(results, wallClockMs);
    const response = {
      id: randomUUID(),
      prompt: request.prompt,
      results,
      summary,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (request.persist && this.store) {
      try {
        this.store.save(
          response,
          request.system,
          request.models,
          request.project
        );
      } catch (err) {
        logger.warn({ error: err }, "Failed to persist comparison result");
      }
    }
    return response;
  }
  /**
   * Retrieve comparison history (delegates to store).
   */
  getHistory(filters = {}) {
    if (!this.store) return [];
    return this.store.query(filters);
  }
  // ── Private helpers ─────────────────────────────────────────
  /**
   * Estimate total cost across all models using pricing module.
   * Uses conservative estimate: assume prompt is ~500 tokens input + maxTokens output.
   */
  estimateTotalCost(models, maxTokens) {
    const estimatedInputTokens = 500;
    let total = 0;
    for (const model of models) {
      const estimate = estimateCost(model, estimatedInputTokens, maxTokens);
      if (estimate) {
        total += estimate.estimatedCost;
      }
    }
    return total;
  }
  /**
   * Execute a single model request with timeout via AbortController.
   */
  async executeModel(model, request, maxTokens, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = Date.now();
    try {
      const internalRequest = {
        messages: [
          ...request.system ? [{ role: "system", content: request.system }] : [],
          { role: "user", content: request.prompt }
        ],
        model,
        maxTokens,
        metadata: {
          signal: controller.signal,
          comparisonMode: true
        }
      };
      const response = await this.router.generateFromInternal(internalRequest);
      const latencyMs = Date.now() - startTime;
      const costUsd = calculateCost(
        response.model,
        response.usage.inputTokens,
        response.usage.outputTokens
      );
      const stabilityScore = this.getStabilityScore(model);
      return {
        model: response.model,
        provider: response.metadata?.["provider"] ?? "unknown",
        status: "success",
        response: response.content,
        tokensIn: response.usage.inputTokens,
        tokensOut: response.usage.outputTokens,
        costUsd,
        latencyMs: response.metadata?.["latencyMs"] ?? latencyMs,
        finishReason: response.finishReason,
        stabilityScore
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));
      const isTimeout = err.name === "AbortError" || err.message.includes("timed out");
      return {
        model,
        provider: "unknown",
        status: isTimeout ? "timeout" : "error",
        error: isTimeout ? `Request timed out after ${timeoutMs}ms` : err.message,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs,
        stabilityScore: this.getStabilityScore(model)
      };
    } finally {
      clearTimeout(timer);
    }
  }
  /**
   * Look up stability score from FreeModelRegistry.
   * Returns undefined if registry is not configured or model is not free-tier.
   */
  getStabilityScore(model) {
    if (!this.freeModelRegistry) return void 0;
    const entry = this.freeModelRegistry.get(model);
    if (entry?.stabilityScore !== void 0) return entry.stabilityScore;
    const allEnabled = this.freeModelRegistry.getEnabled();
    const match = allEnabled.find((m) => m.modelId === model || m.id === model);
    return match?.stabilityScore;
  }
  /**
   * Build comparison summary from results.
   * Only considers successful results for fastest/cheapest rankings.
   */
  buildSummary(results, wallClockMs) {
    const successful = results.filter((r) => r.status === "success");
    let fastestModel;
    let cheapestModel;
    let totalCost = 0;
    if (successful.length > 0) {
      const fastest = successful.reduce(
        (a, b) => a.latencyMs < b.latencyMs ? a : b
      );
      fastestModel = fastest.model;
      const cheapest = successful.reduce(
        (a, b) => a.costUsd < b.costUsd ? a : b
      );
      cheapestModel = cheapest.model;
    }
    for (const result of results) {
      totalCost += result.costUsd;
    }
    return {
      fastestModel,
      cheapestModel,
      totalCost,
      wallClockMs
    };
  }
};

// src/context-compression/types.ts
var DEFAULT_COMPRESSOR_CONFIG = {
  maxCacheSize: 200,
  workerIntervalMs: 5e3,
  defaultStrategy: "extractive",
  defaultRatio: 0.5
};

// src/context-compression/cache.ts
function contentHash(content) {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = (hash << 5) + hash + content.charCodeAt(i) | 0;
  }
  return `cc_${hash.toString(36)}`;
}
var LRUCompressionCache = class {
  cache = /* @__PURE__ */ new Map();
  maxSize;
  constructor(maxSize = 200) {
    this.maxSize = maxSize;
  }
  /**
   * Get a cached compressed result for the given content.
   * Returns null on cache miss. Promotes the entry on hit.
   */
  get(content) {
    const key = contentHash(content);
    const entry = this.cache.get(key);
    if (!entry) return null;
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.compressed;
  }
  /**
   * Store a compressed result in the cache.
   * Evicts the LRU entry if the cache is at capacity.
   */
  set(content, compressed, strategy) {
    const key = contentHash(content);
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== void 0) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, {
      compressed,
      strategy,
      createdAt: Date.now()
    });
  }
  /**
   * Check if content has a cached compressed version.
   */
  has(content) {
    return this.cache.has(contentHash(content));
  }
  /** Current number of entries in the cache. */
  get size() {
    return this.cache.size;
  }
  /** Clear all entries. */
  clear() {
    this.cache.clear();
  }
};

// src/context-compression/strategies.ts
function scoreSentence(sentence, index, total) {
  let score = 0;
  score += Math.min(sentence.length / 100, 1);
  if (index === 0 || index === total - 1) {
    score += 1.5;
  } else if (index < 3) {
    score += 0.5;
  }
  const keywords = /\b(must|should|important|key|critical|note|requires|error|warning|always|never)\b/i;
  if (keywords.test(sentence)) {
    score += 1;
  }
  return score;
}
function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
}
var ExtractiveStrategy = class {
  name = "extractive";
  compress(content, options) {
    if (!content) return "";
    const ratio = options?.ratio ?? 0.5;
    const sentences = splitSentences(content);
    if (sentences.length <= 1) return content;
    const keepCount = Math.max(1, Math.ceil(sentences.length * ratio));
    const scored = sentences.map((s, i) => ({
      sentence: s,
      index: i,
      score: scoreSentence(s, i, sentences.length)
    }));
    const selected = scored.sort((a, b) => b.score - a.score).slice(0, keepCount).sort((a, b) => a.index - b.index);
    return selected.map((s) => s.sentence).join(" ");
  }
};
var StructuralStrategy = class {
  name = "structural";
  compress(content, _options) {
    if (!content) return "";
    const lines = content.split("\n");
    const result = [];
    let lastWasHeading = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^#{1,6}\s/.test(trimmed)) {
        result.push(line);
        lastWasHeading = true;
        continue;
      }
      if (lastWasHeading && trimmed.length > 0) {
        result.push(line);
        lastWasHeading = false;
        continue;
      }
      if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
        result.push(line);
        continue;
      }
      lastWasHeading = false;
    }
    if (result.length === 0) {
      return lines.slice(0, Math.max(1, Math.ceil(lines.length * 0.3))).join("\n");
    }
    return result.join("\n");
  }
};
var TokenBudgetStrategy = class {
  name = "token-budget";
  compress(content, options) {
    if (!content) return "";
    const maxChars = options?.maxChars ?? Math.ceil(content.length * (options?.ratio ?? 0.5));
    if (content.length <= maxChars) return content;
    const sentences = splitSentences(content);
    let result = "";
    for (const sentence of sentences) {
      const next = result ? `${result} ${sentence}` : sentence;
      if (next.length > maxChars) break;
      result = next;
    }
    if (!result) {
      return content.slice(0, maxChars);
    }
    return result;
  }
};
var STRATEGIES = {
  extractive: new ExtractiveStrategy(),
  structural: new StructuralStrategy(),
  "token-budget": new TokenBudgetStrategy()
};
function getStrategy(name) {
  const strategy = STRATEGIES[name];
  if (!strategy) {
    throw new Error(`Unknown compression strategy: "${name}". Available: ${Object.keys(STRATEGIES).join(", ")}`);
  }
  return strategy;
}

// src/context-compression/worker.ts
var BackgroundCompressionWorker = class {
  queue = [];
  cache;
  timer = null;
  intervalMs;
  constructor(cache, intervalMs = 5e3) {
    this.cache = cache;
    this.intervalMs = intervalMs;
  }
  /**
   * Start the background processing loop.
   */
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.processQueue(), this.intervalMs);
    if (typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref();
    }
  }
  /**
   * Submit content for background compression.
   */
  submit(content, strategy, options) {
    if (this.cache.has(content)) return;
    const alreadyQueued = this.queue.some((item) => item.content === content);
    if (alreadyQueued) return;
    this.queue.push({ content, strategy, options });
  }
  /**
   * Process all queued items. Called by the interval timer.
   * Exposed for testing.
   */
  processQueue() {
    const items = this.queue.splice(0);
    for (const item of items) {
      if (this.cache.has(item.content)) continue;
      try {
        const strategy = getStrategy(item.strategy);
        const compressed = strategy.compress(item.content, item.options);
        this.cache.set(item.content, compressed, item.strategy);
      } catch {
      }
    }
  }
  /** Number of items waiting in the queue. */
  get pendingCount() {
    return this.queue.length;
  }
  /**
   * Stop the background worker and clear the queue.
   * MUST be called to prevent interval leaks.
   */
  destroy() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.queue.length = 0;
  }
};

// src/context-compression/service.ts
var CompressorService = class {
  cache;
  worker;
  config;
  constructor(config2) {
    this.config = { ...DEFAULT_COMPRESSOR_CONFIG, ...config2 };
    this.cache = new LRUCompressionCache(this.config.maxCacheSize);
    this.worker = new BackgroundCompressionWorker(this.cache, this.config.workerIntervalMs);
    this.worker.start();
  }
  /**
   * Submit content for background compression.
   * The content will be compressed asynchronously and cached.
   */
  submit(content, options) {
    this.worker.submit(content, this.config.defaultStrategy, options);
  }
  /**
   * Get the compressed version of content, or the original if not yet cached.
   * This is designed to be instant — never blocks on compression.
   */
  getCompressed(content) {
    return this.cache.get(content) ?? content;
  }
  /**
   * Check if a compressed version is available for the given content.
   */
  hasCompressed(content) {
    return this.cache.has(content);
  }
  /**
   * Compress content synchronously using a specific strategy.
   * Useful when you need the result immediately and can't wait for background.
   * Also caches the result.
   */
  compressNow(content, strategyName, options) {
    const name = strategyName ?? this.config.defaultStrategy;
    const strategy = getStrategy(name);
    const mergedOptions = {
      ratio: this.config.defaultRatio,
      ...options
    };
    const compressed = strategy.compress(content, mergedOptions);
    this.cache.set(content, compressed, name);
    return compressed;
  }
  /** Number of items in the compression cache. */
  get cacheSize() {
    return this.cache.size;
  }
  /** Number of items waiting for background compression. */
  get pendingCount() {
    return this.worker.pendingCount;
  }
  /**
   * Destroy the service — stops the background worker and clears the cache.
   * MUST be called on shutdown to prevent interval leaks.
   */
  destroy() {
    this.worker.destroy();
    this.cache.clear();
  }
};

// src/core/config.ts
import { randomBytes } from "crypto";
import { existsSync as existsSync4, mkdirSync as mkdirSync3, readFileSync as readFileSync4, writeFileSync as writeFileSync3 } from "fs";
import { join as join5 } from "path";
import { homedir as homedir2 } from "os";
var DEFAULT_DIR = join5(homedir2(), ".llm-gateway");
var DEFAULT_DB_PATH = join5(DEFAULT_DIR, DEFAULT_DB_FILENAME);
var DEFAULT_MASTER_KEY_PATH = join5(DEFAULT_DIR, DEFAULT_MASTER_KEY_FILENAME);
function isProduction() {
  const nodeEnv = process.env["NODE_ENV"];
  const gatewayEnv = process.env["LLM_GATEWAY_ENV"];
  const isProd = nodeEnv === "production" || gatewayEnv === "production";
  return isProd;
}
function ensureConfigDir(dirPath) {
  if (!existsSync4(dirPath)) {
    mkdirSync3(dirPath, { recursive: true, mode: 448 });
  }
}
function loadMasterKey() {
  const envKey = process.env["LLM_GATEWAY_MASTER_KEY"];
  if (envKey) {
    const buf = Buffer.from(envKey, "hex");
    if (buf.length !== MASTER_KEY_BYTES) {
      throw new Error(
        `LLM_GATEWAY_MASTER_KEY must be a ${MASTER_KEY_BYTES * 2}-character hex string (${MASTER_KEY_BYTES} bytes). Got ${buf.length} bytes.`
      );
    }
    return buf;
  }
  if (existsSync4(DEFAULT_MASTER_KEY_PATH)) {
    const hex = readFileSync4(DEFAULT_MASTER_KEY_PATH, "utf8").trim();
    const buf = Buffer.from(hex, "hex");
    if (buf.length !== MASTER_KEY_BYTES) {
      throw new Error(
        `Master key file at ${DEFAULT_MASTER_KEY_PATH} is corrupted. Expected ${MASTER_KEY_BYTES} bytes, got ${buf.length}.`
      );
    }
    return buf;
  }
  ensureConfigDir(DEFAULT_DIR);
  const key = randomBytes(MASTER_KEY_BYTES);
  writeFileSync3(DEFAULT_MASTER_KEY_PATH, key.toString("hex") + "\n", {
    mode: 384,
    encoding: "utf8"
  });
  logger.info({ path: DEFAULT_MASTER_KEY_PATH }, "Generated new master key");
  return key;
}
function loadConfig() {
  const masterKey = loadMasterKey();
  const dbPath = process.env["LLM_GATEWAY_DB_PATH"] ?? DEFAULT_DB_PATH;
  ensureConfigDir(join5(dbPath, ".."));
  const portStr = process.env["LLM_GATEWAY_PORT"];
  const httpPort = portStr ? parseInt(portStr, 10) : DEFAULT_HTTP_PORT;
  if (isNaN(httpPort) || httpPort < 1 || httpPort > 65535) {
    throw new Error(`LLM_GATEWAY_PORT must be a valid port number (1-65535). Got: "${portStr}"`);
  }
  const rawAuthToken = process.env["LLM_GATEWAY_AUTH_TOKEN"]?.trim();
  const authRequired = process.env["LLM_GATEWAY_AUTH_REQUIRED"];
  let authToken;
  const explicitAuthDisabled = authRequired === "false";
  const explicitAuthRequired = authRequired === "true";
  if (rawAuthToken) {
    if (rawAuthToken.length < MIN_AUTH_TOKEN_LENGTH) {
      throw new Error(
        `LLM_GATEWAY_AUTH_TOKEN must be at least ${MIN_AUTH_TOKEN_LENGTH} characters. Got ${rawAuthToken.length}.`
      );
    }
    authToken = rawAuthToken;
  } else if (explicitAuthRequired) {
    throw new Error(
      "FATAL: LLM_GATEWAY_AUTH_TOKEN is required because LLM_GATEWAY_AUTH_REQUIRED=true. Set LLM_GATEWAY_AUTH_TOKEN environment variable."
    );
  } else if (isProduction() && !explicitAuthDisabled) {
    throw new Error(
      "FATAL: LLM_GATEWAY_AUTH_TOKEN is required in production. Set LLM_GATEWAY_AUTH_TOKEN environment variable, set NODE_ENV=development, or set LLM_GATEWAY_AUTH_REQUIRED=false to explicitly disable auth."
    );
  } else if (explicitAuthDisabled) {
    logger.info("Auth explicitly disabled via LLM_GATEWAY_AUTH_REQUIRED=false");
  } else {
    logger.warn("Auth disabled (not production, LLM_GATEWAY_AUTH_REQUIRED not set)");
  }
  const VALID_PROFILES = ["local-dev", "restricted", "open"];
  const rawProfile = process.env["LLM_GATEWAY_SECURITY_PROFILE"]?.trim() ?? "local-dev";
  if (!VALID_PROFILES.includes(rawProfile)) {
    throw new Error(
      `LLM_GATEWAY_SECURITY_PROFILE must be one of: ${VALID_PROFILES.join(", ")}. Got: "${rawProfile}"`
    );
  }
  const securityProfile = rawProfile;
  return { masterKey, dbPath, httpPort, authToken, securityProfile };
}

// src/core/cost-tracker.ts
import Database from "better-sqlite3";
import { existsSync as existsSync5, mkdirSync as mkdirSync4 } from "fs";
import { dirname as dirname3 } from "path";

// src/vault/schema.ts
function initializeDb(db2) {
  const tableExists = db2.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='credentials'"
  ).get();
  if (tableExists) {
    const columns = db2.pragma("table_info(credentials)");
    const hasProject = columns.some((col) => col.name === "project");
    const hasLengthHint = columns.some((col) => col.name === "length_hint");
    if (!hasProject) {
      db2.exec(`ALTER TABLE credentials ADD COLUMN project TEXT NOT NULL DEFAULT '${GLOBAL_PROJECT}'`);
      db2.exec(`
        CREATE TABLE IF NOT EXISTS credentials_new (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          provider        TEXT NOT NULL,
          key_name        TEXT NOT NULL DEFAULT 'default',
          project         TEXT NOT NULL DEFAULT '${GLOBAL_PROJECT}',
          encrypted_value BLOB NOT NULL,
          iv              BLOB NOT NULL,
          auth_tag        BLOB NOT NULL,
          length_hint     INTEGER,
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(provider, key_name, project)
        );

        INSERT INTO credentials_new (id, provider, key_name, project, encrypted_value, iv, auth_tag, length_hint, created_at, updated_at)
          SELECT id, provider, key_name, project, encrypted_value, iv, auth_tag, NULL, created_at, updated_at
          FROM credentials;

        DROP TABLE credentials;

        ALTER TABLE credentials_new RENAME TO credentials;
      `);
    }
    if (!hasLengthHint) {
      db2.exec(`ALTER TABLE credentials ADD COLUMN length_hint INTEGER`);
    }
  } else {
    db2.exec(`
      CREATE TABLE IF NOT EXISTS credentials (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        provider        TEXT NOT NULL,
        key_name        TEXT NOT NULL DEFAULT 'default',
        project         TEXT NOT NULL DEFAULT '${GLOBAL_PROJECT}',
        encrypted_value BLOB NOT NULL,
        iv              BLOB NOT NULL,
        auth_tag        BLOB NOT NULL,
        length_hint     INTEGER,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(provider, key_name, project)
      );
    `);
  }
  db2.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      provider        TEXT NOT NULL,
      file_name       TEXT NOT NULL,
      project         TEXT NOT NULL DEFAULT '${GLOBAL_PROJECT}',
      encrypted_value BLOB NOT NULL,
      iv              BLOB NOT NULL,
      auth_tag        BLOB NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider, file_name, project)
    );
  `);
  db2.exec(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      provider    TEXT NOT NULL,
      key_name    TEXT NOT NULL DEFAULT 'default',
      model       TEXT NOT NULL,
      project     TEXT NOT NULL DEFAULT '${GLOBAL_PROJECT}',
      tokens_in   INTEGER NOT NULL DEFAULT 0,
      tokens_out  INTEGER NOT NULL DEFAULT 0,
      cost_usd    REAL NOT NULL DEFAULT 0.0,
      latency_ms  INTEGER NOT NULL DEFAULT 0,
      success     INTEGER NOT NULL DEFAULT 1,
      error_message TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_usage_provider_time ON usage_logs(provider, created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_model_time ON usage_logs(model, created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_project_time ON usage_logs(project, created_at);
  `);
  db2.exec(`
    CREATE TABLE IF NOT EXISTS price_config (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      provider        TEXT NOT NULL,
      model           TEXT NOT NULL,
      input_per_mtok  REAL NOT NULL,
      output_per_mtok REAL NOT NULL,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider, model)
    );
  `);
  db2.exec(`
    CREATE TABLE IF NOT EXISTS security_profiles (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      project             TEXT NOT NULL UNIQUE,
      trust_level         TEXT NOT NULL DEFAULT 'restricted',
      allowed_categories  TEXT NOT NULL DEFAULT '[]',
      rate_limit_max      INTEGER,
      rate_limit_window_ms INTEGER,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db2.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id                  TEXT PRIMARY KEY,
      key_hash            TEXT NOT NULL UNIQUE,
      key_prefix          TEXT NOT NULL,
      user_id             TEXT NOT NULL,
      project             TEXT,
      trust_level         TEXT NOT NULL DEFAULT 'restricted',
      rate_limit_max      INTEGER NOT NULL DEFAULT 100,
      rate_limit_window_ms INTEGER NOT NULL DEFAULT 900000,
      budget_usd          REAL NOT NULL DEFAULT 0.0,
      enabled             INTEGER NOT NULL DEFAULT 1,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at          TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
  `);
  db2.exec(`
    CREATE TABLE IF NOT EXISTS user_quotas (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         TEXT NOT NULL,
      quota_type      TEXT NOT NULL CHECK(quota_type IN ('daily', 'monthly')),
      max_tokens      INTEGER NOT NULL DEFAULT 0,
      max_cost_usd    REAL NOT NULL DEFAULT 0.0,
      period_start    TEXT NOT NULL DEFAULT (datetime('now')),
      used_tokens     INTEGER NOT NULL DEFAULT 0,
      used_cost_usd   REAL NOT NULL DEFAULT 0.0,
      UNIQUE(user_id, quota_type)
    );

    CREATE INDEX IF NOT EXISTS idx_user_quotas_user ON user_quotas(user_id);
  `);
  db2.exec(`
    CREATE TABLE IF NOT EXISTS comparison_results (
      id              TEXT PRIMARY KEY,
      prompt          TEXT NOT NULL,
      system_prompt   TEXT,
      models          TEXT NOT NULL,
      results         TEXT NOT NULL,
      summary         TEXT NOT NULL,
      project         TEXT NOT NULL DEFAULT '${GLOBAL_PROJECT}',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_comparison_project ON comparison_results(project);
    CREATE INDEX IF NOT EXISTS idx_comparison_created ON comparison_results(created_at);
  `);
}

// src/core/cost-tracker.ts
var DEFAULT_FLUSH_INTERVAL_MS = 5e3;
var DEFAULT_QUERY_LIMIT = 1e3;
var CostTracker = class {
  db;
  buffer = [];
  flushInterval;
  insertStmt;
  constructor(options) {
    const { dbPath, flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS } = options;
    const dir = dirname3(dbPath);
    if (!existsSync5(dir)) {
      mkdirSync4(dir, { recursive: true, mode: 448 });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    initializeDb(this.db);
    this.insertStmt = this.db.prepare(`
      INSERT INTO usage_logs (provider, key_name, model, project, tokens_in, tokens_out, cost_usd, latency_ms, success, error_message, created_at)
      VALUES (@provider, @keyName, @model, @project, @tokensIn, @tokensOut, @costUsd, @latencyMs, @success, @errorMessage, datetime('now'))
    `);
    this.flushInterval = setInterval(() => this.flush(), flushIntervalMs);
    this.flushInterval.unref();
    logger.debug({ dbPath, flushIntervalMs }, "CostTracker initialized");
  }
  /**
   * Record a usage entry into the in-memory buffer.
   * Automatically calculates cost if not provided.
   */
  record(entry) {
    if (entry.costUsd === void 0) {
      entry.costUsd = calculateCost(entry.model, entry.tokensIn, entry.tokensOut);
    }
    this.buffer.push(entry);
  }
  /**
   * Flush the in-memory buffer to SQLite in a single transaction.
   */
  flush() {
    if (this.buffer.length === 0) return;
    const entries = this.buffer.splice(0, this.buffer.length);
    const insertMany = this.db.transaction((items) => {
      for (const entry of items) {
        this.insertStmt.run({
          provider: entry.provider,
          keyName: entry.keyName ?? "default",
          model: entry.model,
          project: entry.project ?? GLOBAL_PROJECT,
          tokensIn: entry.tokensIn,
          tokensOut: entry.tokensOut,
          costUsd: entry.costUsd ?? 0,
          latencyMs: entry.latencyMs,
          success: entry.success ? 1 : 0,
          errorMessage: entry.errorMessage ?? null
        });
      }
    });
    try {
      insertMany(entries);
      logger.debug({ count: entries.length }, "Flushed usage records to SQLite");
    } catch (error) {
      this.buffer.unshift(...entries);
      logger.error({ error }, "Failed to flush usage records");
    }
  }
  /** Get the current buffer size (for testing/monitoring). */
  get bufferSize() {
    return this.buffer.length;
  }
  /**
   * Query usage records with optional filters.
   */
  query(filters = {}) {
    const conditions = [];
    const params = {};
    if (filters.provider) {
      conditions.push("provider = @provider");
      params["provider"] = filters.provider;
    }
    if (filters.model) {
      conditions.push("model = @model");
      params["model"] = filters.model;
    }
    if (filters.project) {
      conditions.push("project = @project");
      params["project"] = filters.project;
    }
    if (filters.from) {
      conditions.push("created_at >= @from");
      params["from"] = filters.from;
    }
    if (filters.to) {
      conditions.push("created_at <= @to");
      params["to"] = filters.to;
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filters.limit ?? DEFAULT_QUERY_LIMIT;
    const sql = `SELECT id, provider, key_name, model, project, tokens_in, tokens_out, cost_usd, latency_ms, success, error_message, created_at FROM usage_logs ${where} ORDER BY created_at DESC LIMIT @limit`;
    const rows = this.db.prepare(sql).all({ ...params, limit });
    return rows.map(this.mapRow);
  }
  /**
   * Get an aggregated usage summary with optional filters and groupBy.
   */
  summary(filters = {}) {
    const conditions = [];
    const params = {};
    if (filters.provider) {
      conditions.push("provider = @provider");
      params["provider"] = filters.provider;
    }
    if (filters.model) {
      conditions.push("model = @model");
      params["model"] = filters.model;
    }
    if (filters.project) {
      conditions.push("project = @project");
      params["project"] = filters.project;
    }
    if (filters.from) {
      conditions.push("created_at >= @from");
      params["from"] = filters.from;
    }
    if (filters.to) {
      conditions.push("created_at <= @to");
      params["to"] = filters.to;
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const totalSql = `
      SELECT
        COUNT(*) as total_requests,
        COALESCE(SUM(tokens_in), 0) as total_tokens_in,
        COALESCE(SUM(tokens_out), 0) as total_tokens_out,
        COALESCE(SUM(cost_usd), 0.0) as total_cost_usd,
        COALESCE(AVG(latency_ms), 0) as avg_latency_ms
      FROM usage_logs ${where}
    `;
    const totals = this.db.prepare(totalSql).get(params);
    let breakdown = [];
    if (filters.groupBy) {
      breakdown = this.getBreakdown(filters.groupBy, where, params);
    }
    return {
      totalRequests: totals.total_requests,
      totalTokensIn: totals.total_tokens_in,
      totalTokensOut: totals.total_tokens_out,
      totalCostUsd: totals.total_cost_usd,
      avgLatencyMs: Math.round(totals.avg_latency_ms),
      breakdown
    };
  }
  /**
   * Create a StreamRecorder for accumulating streaming usage.
   *
   * Usage:
   *   const recorder = costTracker.recordStream('openai', 'gpt-4o');
   *   // ... for each chunk: recorder.addChunk({ tokensOut: n }) ...
   *   recorder.finish(); // writes final record to buffer
   */
  recordStream(provider, model, project) {
    return new StreamRecorder(this, provider, model, project);
  }
  /**
   * Check whether a user has remaining budget for the current month.
   *
   * Queries usage_logs by key_name (correlated to userId by the auth middleware)
   * to get the user's total spend since the start of the current month.
   *
   * @param userId - The user ID to check budget for.
   * @param budgetUsd - The maximum monthly budget in USD. 0 = unlimited.
   * @returns Whether the request is allowed and the remaining budget.
   */
  checkBudget(userId, budgetUsd) {
    if (budgetUsd <= 0) {
      return { allowed: true, remaining: Infinity };
    }
    const now = /* @__PURE__ */ new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const row = this.db.prepare(
      `SELECT COALESCE(SUM(cost_usd), 0.0) as total_cost
         FROM usage_logs
         WHERE key_name = ? AND created_at >= ?`
    ).get(userId, monthStart);
    const used = row?.total_cost ?? 0;
    const remaining = Math.max(0, budgetUsd - used);
    return {
      allowed: remaining > 0,
      remaining
    };
  }
  /**
   * Clean up: flush remaining buffer, stop interval, close DB.
   */
  destroy() {
    clearInterval(this.flushInterval);
    this.flush();
    this.db.close();
    logger.debug("CostTracker destroyed");
  }
  // ── Private helpers ────────────────────────────────────
  getBreakdown(groupBy, where, params) {
    let groupColumn;
    switch (groupBy) {
      case "provider":
        groupColumn = "provider";
        break;
      case "model":
        groupColumn = "model";
        break;
      case "project":
        groupColumn = "project";
        break;
      case "hour":
        groupColumn = "strftime('%Y-%m-%d %H:00', created_at)";
        break;
      case "day":
        groupColumn = "strftime('%Y-%m-%d', created_at)";
        break;
      default:
        return [];
    }
    const sql = `
      SELECT
        ${groupColumn} as group_key,
        COUNT(*) as request_count,
        COALESCE(SUM(tokens_in), 0) as total_tokens_in,
        COALESCE(SUM(tokens_out), 0) as total_tokens_out,
        COALESCE(SUM(cost_usd), 0.0) as total_cost_usd,
        COALESCE(AVG(latency_ms), 0) as avg_latency_ms
      FROM usage_logs ${where}
      GROUP BY ${groupColumn}
      ORDER BY total_cost_usd DESC
    `;
    const rows = this.db.prepare(sql).all(params);
    return rows.map((row) => ({
      key: row.group_key,
      requests: row.request_count,
      tokensIn: row.total_tokens_in,
      tokensOut: row.total_tokens_out,
      costUsd: row.total_cost_usd,
      avgLatencyMs: Math.round(row.avg_latency_ms)
    }));
  }
  mapRow(row) {
    return {
      id: row.id,
      provider: row.provider,
      keyName: row.key_name,
      model: row.model,
      project: row.project,
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      costUsd: row.cost_usd,
      latencyMs: row.latency_ms,
      success: row.success === 1,
      errorMessage: row.error_message,
      createdAt: row.created_at
    };
  }
};
var StreamRecorder = class {
  constructor(tracker, provider, model, project) {
    this.tracker = tracker;
    this.provider = provider;
    this.model = model;
    this.project = project;
    this._startTime = Date.now();
  }
  _tokensIn = 0;
  _tokensOut = 0;
  _charCount = 0;
  _finished = false;
  _startTime;
  /**
   * Accumulate token counts from a streaming chunk.
   * Call this for every chunk that reports partial usage.
   */
  addChunk(tokens, contentLength = 0) {
    if (this._finished) return;
    if (tokens?.tokensIn !== void 0) this._tokensIn = tokens.tokensIn;
    if (tokens?.tokensOut !== void 0) this._tokensOut = tokens.tokensOut;
    this._charCount += contentLength;
  }
  /**
   * Finalize the stream and write the usage record.
   *
   * If the provider didn't report per-chunk tokens, estimates
   * output tokens from accumulated character count (~4 chars/token).
   */
  finish(errorMessage) {
    if (this._finished) return;
    this._finished = true;
    const latencyMs = Date.now() - this._startTime;
    const tokensOut = this._tokensOut > 0 ? this._tokensOut : Math.ceil(this._charCount / 4);
    this.tracker.record({
      provider: this.provider,
      model: this.model,
      project: this.project,
      tokensIn: this._tokensIn,
      tokensOut,
      latencyMs,
      success: !errorMessage,
      errorMessage
    });
  }
  /** Whether finish() has been called. */
  get finished() {
    return this._finished;
  }
  /** Current accumulated input tokens. */
  get tokensIn() {
    return this._tokensIn;
  }
  /** Current accumulated output tokens (0 if not yet reported by provider). */
  get tokensOut() {
    return this._tokensOut;
  }
};

// src/core/groups.ts
import { z } from "zod";
import Database2 from "better-sqlite3";
import { existsSync as existsSync6, mkdirSync as mkdirSync5 } from "fs";
import { dirname as dirname4 } from "path";

// src/core/fuzzy.ts
var DEFAULT_THRESHOLD = 0.85;
var DEFAULT_AMBIGUITY_DELTA = 0.02;
function normalizeModelId(id) {
  let cleaned = id;
  const colonIdx = cleaned.indexOf(":");
  if (colonIdx !== -1) {
    cleaned = cleaned.slice(colonIdx + 1);
  }
  const slashIdx = cleaned.lastIndexOf("/");
  if (slashIdx !== -1) {
    cleaned = cleaned.slice(slashIdx + 1);
  }
  return normalizeModelName(cleaned);
}
function jaroWinkler(a, b) {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const maxDist = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  if (maxDist < 0) return a === b ? 1 : 0;
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);
  let matches = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - maxDist);
    const end = Math.min(i + maxDist + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  const maxPrefix = Math.min(4, Math.min(a.length, b.length));
  for (let i = 0; i < maxPrefix; i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}
function resolveModel(input, corpus, options) {
  if (corpus.length === 0) return null;
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const ambiguityDelta = options?.ambiguityDelta ?? DEFAULT_AMBIGUITY_DELTA;
  const exactMatch = corpus.find((c) => c === input);
  if (exactMatch) {
    return { match: exactMatch, score: 1 };
  }
  const normalizedInput = normalizeModelId(input);
  for (const entry of corpus) {
    if (normalizeModelId(entry) === normalizedInput) {
      return { match: entry, score: 1 };
    }
  }
  let best = null;
  let secondBest = 0;
  for (const entry of corpus) {
    const score = jaroWinkler(normalizedInput, normalizeModelId(entry));
    if (!best || score > best.score) {
      secondBest = best?.score ?? 0;
      best = { entry, score };
    } else if (score > secondBest) {
      secondBest = score;
    }
  }
  if (!best || best.score < threshold) {
    return null;
  }
  if (best.score - secondBest < ambiguityDelta) {
    logger.warn(
      {
        input,
        candidate1: best.entry,
        score1: best.score,
        score2: secondBest
      },
      "Fuzzy match rejected: ambiguous \u2014 top-2 scores too close"
    );
    return null;
  }
  logger.warn(
    { input, resolved: best.entry, score: best.score },
    "Fuzzy model resolution activated"
  );
  return { match: best.entry, score: best.score };
}

// src/core/groups.ts
var BalancerStrategySchema = z.enum([
  "round-robin",
  "random",
  "failover",
  "weighted"
]);
var GroupMemberSchema = z.object({
  provider: z.string().min(1),
  keyName: z.string().optional(),
  weight: z.number().positive().optional(),
  priority: z.number().int().nonnegative().optional()
});
var ProviderGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  modelPattern: z.string().optional(),
  members: z.array(GroupMemberSchema).min(1),
  strategy: BalancerStrategySchema,
  weights: z.record(z.string(), z.number().positive()).optional(),
  stickyTTL: z.number().int().positive().optional()
});
var CreateGroupSchema = z.object({
  name: z.string().min(1),
  modelPattern: z.string().optional(),
  members: z.array(GroupMemberSchema).min(1),
  strategy: BalancerStrategySchema,
  weights: z.record(z.string(), z.number().positive()).optional(),
  stickyTTL: z.number().int().positive().optional()
});
var UpdateGroupSchema = z.object({
  name: z.string().min(1).optional(),
  modelPattern: z.string().optional(),
  members: z.array(GroupMemberSchema).min(1).optional(),
  strategy: BalancerStrategySchema.optional(),
  weights: z.record(z.string(), z.number().positive()).optional(),
  stickyTTL: z.number().int().positive().optional()
});
var GroupStore = class {
  db;
  /** In-memory cache for fast routing lookups. */
  cache = /* @__PURE__ */ new Map();
  constructor(dbPath) {
    const dir = dirname4(dbPath);
    if (!existsSync6(dir)) {
      mkdirSync5(dir, { recursive: true, mode: 448 });
    }
    this.db = new Database2(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
    this.refreshCache();
  }
  /** Create the provider_groups table if it doesn't exist. */
  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS provider_groups (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        model_pattern TEXT,
        members_json  TEXT NOT NULL,
        strategy      TEXT NOT NULL DEFAULT 'round-robin',
        weights_json  TEXT,
        sticky_ttl    INTEGER,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }
  /** Reload all groups from SQLite into the in-memory cache. */
  refreshCache() {
    const rows = this.db.prepare("SELECT * FROM provider_groups ORDER BY name").all();
    this.cache.clear();
    for (const row of rows) {
      this.cache.set(row.id, this.rowToGroup(row));
    }
  }
  /** Convert a DB row to a ProviderGroup. */
  rowToGroup(row) {
    return {
      id: row.id,
      name: row.name,
      modelPattern: row.model_pattern ?? void 0,
      members: JSON.parse(row.members_json),
      strategy: row.strategy,
      weights: row.weights_json ? JSON.parse(row.weights_json) : void 0,
      stickyTTL: row.sticky_ttl ?? void 0
    };
  }
  /** Generate a URL-safe ID from the group name. */
  generateId(name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const existing = this.cache.has(slug);
    if (!existing) return slug;
    return `${slug}-${Date.now().toString(36).slice(-4)}`;
  }
  // ── CRUD ───────────────────────────────────────────────────
  /** Create a new provider group. Returns the created group. */
  create(input) {
    const validated = CreateGroupSchema.parse(input);
    const id = this.generateId(validated.name);
    const group = {
      id,
      name: validated.name,
      modelPattern: validated.modelPattern,
      members: validated.members,
      strategy: validated.strategy,
      weights: validated.weights,
      stickyTTL: validated.stickyTTL
    };
    this.db.prepare(
      `INSERT INTO provider_groups (id, name, model_pattern, members_json, strategy, weights_json, sticky_ttl)
         VALUES (@id, @name, @modelPattern, @membersJson, @strategy, @weightsJson, @stickyTtl)`
    ).run({
      id: group.id,
      name: group.name,
      modelPattern: group.modelPattern ?? null,
      membersJson: JSON.stringify(group.members),
      strategy: group.strategy,
      weightsJson: group.weights ? JSON.stringify(group.weights) : null,
      stickyTtl: group.stickyTTL ?? null
    });
    this.cache.set(id, group);
    return group;
  }
  /** Get a group by ID. Returns null if not found. */
  get(id) {
    return this.cache.get(id) ?? null;
  }
  /** List all groups. */
  list() {
    return Array.from(this.cache.values());
  }
  /** Update a group by ID. Returns the updated group or null if not found. */
  update(id, input) {
    const existing = this.cache.get(id);
    if (!existing) return null;
    const validated = UpdateGroupSchema.parse(input);
    const updated = {
      ...existing,
      name: validated.name ?? existing.name,
      modelPattern: validated.modelPattern !== void 0 ? validated.modelPattern : existing.modelPattern,
      members: validated.members ?? existing.members,
      strategy: validated.strategy ?? existing.strategy,
      weights: validated.weights !== void 0 ? validated.weights : existing.weights,
      stickyTTL: validated.stickyTTL !== void 0 ? validated.stickyTTL : existing.stickyTTL
    };
    this.db.prepare(
      `UPDATE provider_groups
         SET name = @name,
             model_pattern = @modelPattern,
             members_json = @membersJson,
             strategy = @strategy,
             weights_json = @weightsJson,
             sticky_ttl = @stickyTtl,
             updated_at = datetime('now')
         WHERE id = @id`
    ).run({
      id,
      name: updated.name,
      modelPattern: updated.modelPattern ?? null,
      membersJson: JSON.stringify(updated.members),
      strategy: updated.strategy,
      weightsJson: updated.weights ? JSON.stringify(updated.weights) : null,
      stickyTtl: updated.stickyTTL ?? null
    });
    this.cache.set(id, updated);
    return updated;
  }
  /** Delete a group by ID. Returns true if deleted, false if not found. */
  delete(id) {
    if (!this.cache.has(id)) return false;
    this.db.prepare("DELETE FROM provider_groups WHERE id = ?").run(id);
    this.cache.delete(id);
    return true;
  }
  /**
   * Find the first group whose modelPattern matches the given model name.
   * Supports glob patterns (* and ?) via conversion to regex.
   */
  findByModel(model) {
    for (const group of this.cache.values()) {
      if (!group.modelPattern) continue;
      if (globMatch(group.modelPattern, model)) return group;
    }
    const corpus = [];
    const patternToGroup = /* @__PURE__ */ new Map();
    for (const group of this.cache.values()) {
      if (!group.modelPattern) continue;
      if (!group.modelPattern.includes("*") && !group.modelPattern.includes("?")) {
        corpus.push(group.modelPattern);
        patternToGroup.set(group.modelPattern, group);
      }
    }
    if (corpus.length > 0) {
      const fuzzyResult = resolveModel(model, corpus);
      if (fuzzyResult) {
        return patternToGroup.get(fuzzyResult.match) ?? null;
      }
    }
    return null;
  }
  /** Close the database connection. */
  close() {
    this.db.close();
  }
};
function globMatch(pattern, value) {
  const patterns = pattern.split(",").map((p) => p.trim());
  return patterns.some((p) => singleGlobMatch(p, value));
}
function singleGlobMatch(pattern, value) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = `^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`;
  return new RegExp(regexStr, "i").test(value);
}

// src/core/metrics.ts
import { Counter, Histogram, Gauge, collectDefaultMetrics, register } from "prom-client";
var httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "path", "status"]
});
var httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "path"],
  buckets: [1e-3, 5e-3, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
});
var llmRequestsTotal = new Counter({
  name: "llm_requests_total",
  help: "Total number of LLM requests",
  labelNames: ["provider", "model", "status"]
});
var llmRequestDuration = new Histogram({
  name: "llm_request_duration_seconds",
  help: "LLM request duration in seconds",
  labelNames: ["provider", "model"],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60]
});
var llmTokensUsedTotal = new Counter({
  name: "llm_tokens_used_total",
  help: "Total number of tokens used",
  labelNames: ["provider", "model"]
});
var vaultOperationsTotal = new Counter({
  name: "vault_operations_total",
  help: "Total number of vault operations",
  labelNames: ["operation", "status"]
});
var providerAvailable = new Gauge({
  name: "provider_available",
  help: "Provider availability (1=available, 0=unavailable)",
  labelNames: ["provider"]
});
function initMetrics() {
  collectDefaultMetrics({
    prefix: "mcp_llm_bridge_"
  });
}
async function getMetrics() {
  return register.metrics();
}
function getMetricsContentType() {
  return register.contentType;
}
async function updateProviderAvailability(router2) {
  const statuses = await router2.getProviderStatuses();
  for (const status of statuses) {
    providerAvailable.set({ provider: status.id }, status.available ? 1 : 0);
  }
}

// src/latency/selector.ts
var SIMILAR_LATENCY_THRESHOLD = 0.2;
function selectProviderWithLatency(candidates, latencyMeasurements, roundRobinIndex = 0) {
  if (candidates.length === 0) {
    throw new Error("No provider candidates available");
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  const withLatency = candidates.map((c) => ({
    ...c,
    latency: latencyMeasurements.get(c.provider) ?? Number.POSITIVE_INFINITY
  }));
  const withValidLatency = withLatency.filter((c) => c.latency > 0 && c.latency !== Number.POSITIVE_INFINITY);
  if (withValidLatency.length === 0) {
    return candidates[roundRobinIndex % candidates.length];
  }
  withValidLatency.sort((a, b) => a.latency - b.latency);
  if (withValidLatency.length === 1) {
    const winner = withValidLatency[0];
    const original2 = candidates.find((c) => c.provider === winner.provider);
    if (original2) {
      return original2;
    }
  }
  const best = withValidLatency[0];
  const second = withValidLatency[1];
  if (second) {
    const latencyDiff = (second.latency - best.latency) / best.latency;
    if (latencyDiff < SIMILAR_LATENCY_THRESHOLD) {
      const eligibleCandidates = candidates.filter(
        (c) => withValidLatency.some((w) => w.provider === c.provider)
      );
      return eligibleCandidates[roundRobinIndex % eligibleCandidates.length];
    }
  }
  const winner2 = withValidLatency[0];
  const original = candidates.find((c) => c.provider === winner2.provider);
  if (!original) {
    return candidates[0];
  }
  return original;
}
function measurementsToMap(measurements) {
  const map = /* @__PURE__ */ new Map();
  for (const m of measurements) {
    if (m.latencyMs > 0) {
      map.set(m.provider, m.latencyMs);
    }
  }
  return map;
}
function buildLatencyMap(measurements) {
  return measurementsToMap(measurements);
}

// src/core/balancer.ts
function memberKey(m) {
  return `${m.provider}:${m.keyName ?? "default"}`;
}
function available(members, excluded) {
  if (!excluded || excluded.size === 0) return members;
  return members.filter((m) => !excluded.has(memberKey(m)));
}
var RoundRobinBalancer = class {
  strategy = "round-robin";
  index = 0;
  next(members, excluded) {
    const pool = available(members, excluded);
    if (pool.length === 0) return null;
    const member = pool[this.index % pool.length];
    this.index = (this.index + 1) % pool.length;
    return member;
  }
  reset() {
    this.index = 0;
  }
};
var RandomBalancer = class {
  strategy = "random";
  next(members, excluded) {
    const pool = available(members, excluded);
    if (pool.length === 0) return null;
    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx];
  }
  reset() {
  }
};
var FailoverBalancer = class {
  strategy = "failover";
  next(members, excluded) {
    const pool = available(members, excluded);
    if (pool.length === 0) return null;
    const sorted = [...pool].sort((a, b) => {
      const pa = a.priority ?? Infinity;
      const pb = b.priority ?? Infinity;
      return pa - pb;
    });
    return sorted[0];
  }
  reset() {
  }
};
var WeightedBalancer = class {
  strategy = "weighted";
  next(members, excluded) {
    const pool = available(members, excluded);
    if (pool.length === 0) return null;
    const totalWeight = pool.reduce((sum, m) => sum + (m.weight ?? 1), 0);
    let random = Math.random() * totalWeight;
    for (const member of pool) {
      random -= member.weight ?? 1;
      if (random <= 0) return member;
    }
    return pool[pool.length - 1];
  }
  reset() {
  }
};
function createBalancer(strategy) {
  switch (strategy) {
    case "round-robin":
      return new RoundRobinBalancer();
    case "random":
      return new RandomBalancer();
    case "failover":
      return new FailoverBalancer();
    case "weighted":
      return new WeightedBalancer();
  }
}

// src/circuit-breaker/circuit-breaker-v2.ts
var CIRCUIT_STATE = {
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN"
};
var DEFAULT_CONFIG2 = {
  failureThreshold: 5,
  baseCooldownMs: 6e4,
  // 60 seconds
  maxCooldownMs: 6e5,
  // 10 minutes
  halfOpenMaxRequests: 3
};
var CircuitBreakerV2 = class {
  circuits;
  config;
  constructor(config2) {
    this.circuits = /* @__PURE__ */ new Map();
    this.config = { ...DEFAULT_CONFIG2, ...config2 };
  }
  /**
   * Build circuit key from provider, key, and model.
   */
  buildKey(provider, key, model) {
    return `${provider}:${key}:${model}`;
  }
  /**
   * Get or create circuit entry.
   */
  getOrCreateEntry(provider, key, model) {
    const circuitKey = this.buildKey(provider, key, model);
    if (!this.circuits.has(circuitKey)) {
      const newEntry = {
        state: CIRCUIT_STATE.CLOSED,
        consecutiveFailures: 0,
        lastFailureTime: 0,
        tripCount: 0,
        halfOpenRequests: 0
      };
      this.circuits.set(circuitKey, newEntry);
    }
    return this.circuits.get(circuitKey);
  }
  /**
   * Calculate cooldown with exponential backoff.
   * Formula: base * 2^(tripCount - 1), capped at maxCooldownMs
   */
  getCooldown(tripCount) {
    const base = this.config.baseCooldownMs;
    const max = this.config.maxCooldownMs;
    const cooldown = base * Math.pow(2, tripCount - 1);
    return Math.min(cooldown, max);
  }
  /**
   * Transition circuit to HALF_OPEN state.
   */
  transitionToHalfOpen(entry) {
    entry.state = CIRCUIT_STATE.HALF_OPEN;
    entry.halfOpenRequests = 0;
  }
  /**
   * Transition circuit to CLOSED state.
   */
  transitionToClosed(entry) {
    entry.state = CIRCUIT_STATE.CLOSED;
    entry.consecutiveFailures = 0;
    entry.halfOpenRequests = 0;
  }
  /**
   * Transition circuit to OPEN state.
   */
  transitionToOpen(entry) {
    entry.state = CIRCUIT_STATE.OPEN;
    entry.lastFailureTime = Date.now();
    entry.tripCount++;
  }
  /**
   * Check if request is allowed for the given provider/key/model combo.
   */
  canExecute(provider, key, model) {
    const entry = this.getOrCreateEntry(provider, key, model);
    switch (entry.state) {
      case CIRCUIT_STATE.CLOSED:
        return { allowed: true, state: CIRCUIT_STATE.CLOSED };
      case CIRCUIT_STATE.OPEN: {
        const cooldown = this.getCooldown(entry.tripCount);
        const elapsed = Date.now() - entry.lastFailureTime;
        const remainingCooldown = cooldown - elapsed;
        if (remainingCooldown <= 0) {
          this.transitionToHalfOpen(entry);
          return { allowed: true, state: CIRCUIT_STATE.HALF_OPEN };
        }
        return {
          allowed: false,
          state: CIRCUIT_STATE.OPEN,
          remainingCooldown
        };
      }
      case CIRCUIT_STATE.HALF_OPEN:
        entry.halfOpenRequests++;
        return { allowed: true, state: CIRCUIT_STATE.HALF_OPEN };
      default:
        return { allowed: true, state: CIRCUIT_STATE.CLOSED };
    }
  }
  /**
   * Record a successful request.
   */
  recordSuccess(provider, key, model) {
    const entry = this.getOrCreateEntry(provider, key, model);
    switch (entry.state) {
      case CIRCUIT_STATE.HALF_OPEN:
        if (entry.halfOpenRequests >= this.config.halfOpenMaxRequests) {
          this.transitionToClosed(entry);
        }
        break;
      case CIRCUIT_STATE.CLOSED:
        entry.consecutiveFailures = 0;
        break;
      case CIRCUIT_STATE.OPEN:
        break;
    }
  }
  /**
   * Record a failed request.
   */
  recordFailure(provider, key, model) {
    const entry = this.getOrCreateEntry(provider, key, model);
    switch (entry.state) {
      case CIRCUIT_STATE.HALF_OPEN:
        entry.state = CIRCUIT_STATE.OPEN;
        entry.lastFailureTime = Date.now();
        entry.consecutiveFailures = 0;
        break;
      case CIRCUIT_STATE.CLOSED:
        entry.lastFailureTime = Date.now();
        entry.consecutiveFailures++;
        if (entry.consecutiveFailures >= this.config.failureThreshold) {
          this.transitionToOpen(entry);
        }
        break;
      case CIRCUIT_STATE.OPEN:
        entry.lastFailureTime = Date.now();
        break;
    }
  }
  /**
   * Get current state for monitoring.
   */
  getState(provider, key, model) {
    const circuitKey = this.buildKey(provider, key, model);
    const entry = this.circuits.get(circuitKey);
    if (!entry) return null;
    return { ...entry };
  }
  /**
   * Get all circuit states (for monitoring/debugging).
   */
  getAllStates() {
    return Array.from(this.circuits.entries()).map(([key, entry]) => ({
      key,
      entry: { ...entry }
    }));
  }
  /**
   * Reset a specific circuit to CLOSED state.
   */
  reset(provider, key, model) {
    const circuitKey = this.buildKey(provider, key, model);
    const entry = this.circuits.get(circuitKey);
    if (entry) {
      this.transitionToClosed(entry);
    }
  }
  /**
   * Get current config.
   */
  getConfig() {
    return { ...this.config };
  }
  /**
   * Update config at runtime.
   */
  updateConfig(config2) {
    this.config = { ...this.config, ...config2 };
  }
};

// src/core/router.ts
var circuitBreakerV2 = null;
function getCircuitBreakerV2() {
  if (!circuitBreakerV2) {
    circuitBreakerV2 = new CircuitBreakerV2();
  }
  return circuitBreakerV2;
}
var Router = class {
  providers = [];
  _transformerRegistry = null;
  _groupStore = null;
  _sessionStore = null;
  _costTracker = null;
  _freeModelRouter = null;
  _latencyMeasurer = null;
  _explorationRate = 0.1;
  // 10% epsilon-greedy
  /** Set the latency measurer for latency-based routing. */
  setLatencyMeasurer(measurer) {
    this._latencyMeasurer = measurer;
  }
  /** Get the latency measurer (null if not set). */
  get latencyMeasurer() {
    return this._latencyMeasurer;
  }
  /** Set the exploration rate for epsilon-greedy routing (0-1). */
  setExplorationRate(rate) {
    this._explorationRate = Math.max(0, Math.min(1, rate));
  }
  /** Get the exploration rate. */
  get explorationRate() {
    return this._explorationRate;
  }
  /** Set the cost tracker for usage recording. */
  setCostTracker(tracker) {
    this._costTracker = tracker;
  }
  /** Get the cost tracker (null if not set). */
  get costTracker() {
    return this._costTracker;
  }
  /** Set the free model router for fallback strategy. */
  setFreeModelRouter(router2) {
    this._freeModelRouter = router2;
  }
  /** Get the free model router (null if not set). */
  get freeModelRouter() {
    return this._freeModelRouter;
  }
  /** Set the transformer registry for the new pipeline. */
  setTransformerRegistry(registry3) {
    this._transformerRegistry = registry3;
  }
  /** Get the transformer registry (null if not set). */
  get transformerRegistry() {
    return this._transformerRegistry;
  }
  /** Set the group store for group-based routing. */
  setGroupStore(store) {
    this._groupStore = store;
  }
  /** Get the group store (null if not set). */
  get groupStore() {
    return this._groupStore;
  }
  /** Set the session store for stickiness. */
  setSessionStore(store) {
    this._sessionStore = store;
  }
  /** Get the session store (null if not set). */
  get sessionStore() {
    return this._sessionStore;
  }
  withResolutionMetadata(request, result, fallbackUsed, latencyMs) {
    return {
      ...result,
      requestedProvider: request.provider,
      requestedModel: request.model,
      resolvedProvider: result.provider,
      resolvedModel: result.model,
      fallbackUsed,
      latencyMs,
      sessionId: result.sessionId
    };
  }
  /** Register a provider adapter with the router. */
  register(provider) {
    this.providers.push(provider);
  }
  /**
   * Generate text by routing the request to the best available provider.
   *
   * Tries each candidate in resolution order and falls back to the next
   * on failure. Throws if all providers fail.
   * Uses circuit breaker to skip providers that are currently failing.
   */
  async generate(request) {
    const startTime = Date.now();
    const candidates = await this.resolveCandidates(request);
    if (candidates.length === 0) {
      throw new Error(
        "No providers available. Store API credentials via vault_store or install a CLI tool."
      );
    }
    const circuitBreaker = getCircuitBreakerV2();
    const model = request.model ?? "unknown";
    const availableCandidates = candidates.filter(
      (p) => circuitBreaker.canExecute(p.id, "default", model).allowed
    );
    if (availableCandidates.length === 0) {
      const openProviders = candidates.map((p) => p.id).join(", ");
      throw new Error(
        `All providers have circuit breakers open: ${openProviders}. Wait for recovery or check provider status.`
      );
    }
    if (request.strict) {
      const provider = availableCandidates[0];
      if (!provider) {
        throw new Error(
          "No providers available. Store API credentials via vault_store or install a CLI tool."
        );
      }
      try {
        const result = await provider.generate(request);
        circuitBreaker.recordSuccess(provider.id, "default", model);
        const latencyMs = Date.now() - startTime;
        this.recordUsage(provider.id, model, result.tokensUsed ?? 0, 0, latencyMs, true, request.project);
        return this.withResolutionMetadata(request, result, false, latencyMs);
      } catch (error) {
        circuitBreaker.recordFailure(provider.id, "default", model);
        const message = error instanceof Error ? error.message : String(error);
        const latencyMs = Date.now() - startTime;
        this.recordUsage(provider.id, model, 0, 0, latencyMs, false, request.project, message);
        logger.warn({ provider: provider.id, model, error: message }, "Provider failed");
        throw error;
      }
    }
    const errors = [];
    for (const [index, provider] of availableCandidates.entries()) {
      try {
        const result = await provider.generate(request);
        circuitBreaker.recordSuccess(provider.id, "default", result.model ?? model);
        const latencyMs = Date.now() - startTime;
        this.recordUsage(provider.id, result.model ?? model, result.tokensUsed ?? 0, 0, latencyMs, true, request.project);
        return this.withResolutionMetadata(request, result, index > 0, latencyMs);
      } catch (error) {
        circuitBreaker.recordFailure(provider.id, "default", model);
        const message = error instanceof Error ? error.message : String(error);
        const latencyMs = Date.now() - startTime;
        this.recordUsage(provider.id, model, 0, 0, latencyMs, false, request.project, message);
        logger.warn({ provider: provider.id, model, error: message }, "Provider failed");
        errors.push(`${provider.id}: ${message}`);
        continue;
      }
    }
    if (this._freeModelRouter?.isAvailable) {
      try {
        logger.info("All paid providers failed, attempting free model fallback");
        const freeResult = await this._freeModelRouter.generate(request);
        const latencyMs = Date.now() - startTime;
        return this.withResolutionMetadata(request, freeResult, true, latencyMs);
      } catch (freeError) {
        const freeMsg = freeError instanceof Error ? freeError.message : String(freeError);
        errors.push(`free-models: ${freeMsg}`);
      }
    }
    throw new Error(
      `All providers failed. Store credentials via vault_store or install a CLI tool.
${errors.join("\n")}`
    );
  }
  /**
   * Generate using the transformer pipeline (InternalLLMRequest → InternalLLMResponse).
   *
   * This is the new pipeline path, used when USE_TRANSFORMERS=true.
   *
   * Routing priority:
   * 1. Check session stickiness (if pinned, use that provider)
   * 2. Check if a Group matches the requested model (via modelPattern)
   *    → If group found, use group's balancer strategy to order providers
   * 3. Fallback to current behavior (sequential through all providers)
   *
   * After successful response: pin session if stickiness is enabled.
   */
  async generateFromInternal(request) {
    if (!this._transformerRegistry) {
      throw new Error("Transformer registry not configured. Call setTransformerRegistry() first.");
    }
    const registry3 = this._transformerRegistry;
    const startTime = Date.now();
    const model = request.model ?? "";
    const clientId = request.metadata?.["clientId"];
    if (this._sessionStore && clientId && model) {
      const pinned = this._sessionStore.get(clientId, model);
      if (pinned) {
        const stickyProvider = this.providers.find((p) => p.id === pinned.provider);
        if (stickyProvider) {
          const circuitBreaker2 = getCircuitBreakerV2();
          if (circuitBreaker2.canExecute(stickyProvider.id, "default", model).allowed) {
            try {
              const result = await this.tryProvider(stickyProvider, request, registry3, startTime, model);
              return result;
            } catch {
              logger.warn({ provider: stickyProvider.id, clientId, model }, "Sticky provider failed, falling through");
            }
          }
        }
      }
    }
    let matchedGroup = null;
    let orderedCandidates = null;
    if (this._groupStore && model) {
      matchedGroup = this._groupStore.findByModel(model);
      if (matchedGroup) {
        orderedCandidates = this.resolveGroupCandidates(matchedGroup, model);
      }
    }
    if (!orderedCandidates) {
      const resolveRequest = {
        prompt: "",
        model: request.model,
        provider: request.metadata?.["provider"]
      };
      orderedCandidates = await this.resolveCandidates(resolveRequest);
    }
    if (orderedCandidates.length === 0) {
      throw new Error(
        "No providers available. Store API credentials via vault_store or install a CLI tool."
      );
    }
    const circuitBreaker = getCircuitBreakerV2();
    const availableCandidates = orderedCandidates.filter(
      (p) => circuitBreaker.canExecute(p.id, "default", model).allowed
    );
    if (availableCandidates.length === 0) {
      const openProviders = orderedCandidates.map((p) => p.id).join(", ");
      throw new Error(
        `All providers have circuit breakers open: ${openProviders}. Wait for recovery or check provider status.`
      );
    }
    const errors = [];
    for (const provider of availableCandidates) {
      try {
        const result = await this.tryProvider(provider, request, registry3, startTime);
        if (this._sessionStore && clientId && model && matchedGroup?.stickyTTL) {
          this._sessionStore.pin(
            clientId,
            model,
            provider.id,
            "default",
            matchedGroup.stickyTTL * 1e3
            // stickyTTL is in seconds, pin expects ms
          );
        }
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${provider.id}: ${message}`);
        continue;
      }
    }
    throw new Error(
      `All providers failed. Store credentials via vault_store or install a CLI tool.
${errors.join("\n")}`
    );
  }
  /**
   * Resolve the best available provider and its streaming transformer.
   *
   * Uses the same resolution logic as generateFromInternal (groups, balancer,
   * circuit breaker) but returns the resolved provider info so the HTTP layer
   * can drive the SSE streaming loop.
   *
   * Returns null if no provider has a streaming transformer registered.
   */
  async resolveStreamingProvider(request) {
    if (!this._transformerRegistry) {
      throw new Error("Transformer registry not configured. Call setTransformerRegistry() first.");
    }
    const registry3 = this._transformerRegistry;
    const model = request.model ?? "";
    let orderedCandidates = null;
    if (this._groupStore && model) {
      const matchedGroup = this._groupStore.findByModel(model);
      if (matchedGroup) {
        orderedCandidates = this.resolveGroupCandidates(matchedGroup, model);
      }
    }
    if (!orderedCandidates) {
      const resolveRequest = {
        prompt: "",
        model: request.model,
        provider: request.metadata?.["provider"]
      };
      orderedCandidates = await this.resolveCandidates(resolveRequest);
    }
    const circuitBreaker = getCircuitBreakerV2();
    const availableCandidates = orderedCandidates.filter(
      (p) => circuitBreaker.canExecute(p.id, "default", model).allowed
    );
    for (const provider of availableCandidates) {
      const streamTransformer = registry3.getStreamOutbound(provider.id);
      if (streamTransformer) {
        return { provider, streamTransformer };
      }
    }
    return null;
  }
  /**
   * Try a single provider through the transformer pipeline.
   * Handles both API providers (with outbound transformer) and CLI providers.
   * Records circuit breaker success/failure.
   */
  async tryProvider(provider, request, registry3, startTime, model = "unknown") {
    const circuitBreaker = getCircuitBreakerV2();
    const outbound = registry3.getOutbound(provider.id);
    if (!outbound) {
      const cliOutbound2 = registry3.getOutbound("cli");
      if (provider.type === "cli" && cliOutbound2) {
        try {
          const nativeRequest = cliOutbound2.transformRequest(request);
          const prompt = nativeRequest["prompt"];
          const system = nativeRequest["system"];
          const result = await provider.generate({
            prompt,
            system,
            model: request.model,
            maxTokens: request.maxTokens
          });
          circuitBreaker.recordSuccess(provider.id, "default", model);
          const response = cliOutbound2.transformResponse(result);
          const latencyMs = Date.now() - startTime;
          this.recordUsage(provider.id, response.model, response.usage.inputTokens, response.usage.outputTokens, latencyMs, true);
          return response;
        } catch (error) {
          circuitBreaker.recordFailure(provider.id, "default", model);
          const message = error instanceof Error ? error.message : String(error);
          const latencyMs = Date.now() - startTime;
          this.recordUsage(provider.id, model, 0, 0, latencyMs, false, void 0, message);
          logger.warn({ provider: provider.id, model, error: message }, "Provider failed (CLI transformer)");
          throw error;
        }
      }
      logger.warn({ provider: provider.id }, "No outbound transformer registered, skipping");
      throw new Error(`no outbound transformer for ${provider.id}`);
    }
    try {
      outbound.transformRequest(request);
      const adapterRequest = {
        prompt: this.extractPromptFromInternal(request),
        system: this.extractSystemFromInternal(request),
        model: request.model,
        maxTokens: request.maxTokens,
        provider: provider.id
      };
      const result = await provider.generate(adapterRequest);
      circuitBreaker.recordSuccess(provider.id, "default", result.model ?? model);
      const latencyMs = Date.now() - startTime;
      const response = {
        content: result.text,
        model: result.model,
        finishReason: "stop",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: result.tokensUsed ?? 0
        },
        metadata: {
          provider: result.provider,
          fallbackUsed: false,
          latencyMs,
          resolvedProvider: result.provider,
          resolvedModel: result.model
        }
      };
      this.recordUsage(provider.id, result.model, response.usage.inputTokens, response.usage.outputTokens, latencyMs, true);
      return response;
    } catch (error) {
      circuitBreaker.recordFailure(provider.id, "default", model);
      const message = error instanceof Error ? error.message : String(error);
      const latencyMs = Date.now() - startTime;
      this.recordUsage(provider.id, model, 0, 0, latencyMs, false, void 0, message);
      logger.warn({ provider: provider.id, model, error: message }, "Provider failed");
      throw error;
    }
  }
  /**
   * Resolve candidates from a provider group using its balancer strategy.
   * Returns providers ordered by the balancer, filtered by circuit breakers.
   */
  resolveGroupCandidates(group, model = "unknown") {
    const balancer = createBalancer(group.strategy);
    const circuitBreaker = getCircuitBreakerV2();
    const excluded = /* @__PURE__ */ new Set();
    for (const member of group.members) {
      const key = memberKey(member);
      if (!circuitBreaker.canExecute(member.provider, "default", model).allowed) {
        excluded.add(key);
      }
    }
    const ordered = [];
    const used = /* @__PURE__ */ new Set();
    for (let i = 0; i < group.members.length; i++) {
      const member = balancer.next(group.members, excluded);
      if (!member) break;
      const key = memberKey(member);
      if (used.has(key)) continue;
      used.add(key);
      const provider = this.providers.find((p) => p.id === member.provider);
      if (provider) {
        ordered.push(provider);
      }
      excluded.add(key);
    }
    return ordered;
  }
  /**
   * Record usage via the cost tracker (if configured).
   * Non-blocking — failures are logged, not thrown.
   */
  recordUsage(provider, model, tokensIn, tokensOut, latencyMs, success, project, errorMessage) {
    if (!this._costTracker) return;
    try {
      this._costTracker.record({
        provider,
        model,
        tokensIn,
        tokensOut,
        latencyMs,
        success,
        project,
        errorMessage
      });
    } catch (error) {
      logger.warn({ error }, "Failed to record usage");
    }
  }
  /**
   * Extract a flat prompt string from InternalLLMRequest messages.
   * Used to bridge to the legacy GenerateRequest format.
   */
  extractPromptFromInternal(request) {
    const nonSystemMessages = request.messages.filter((m) => m.role !== "system");
    return nonSystemMessages.map((m) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return m.content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
      }
      return "";
    }).filter(Boolean).join("\n");
  }
  /**
   * Extract system prompt from InternalLLMRequest messages.
   */
  extractSystemFromInternal(request) {
    const systemMessages = request.messages.filter((m) => m.role === "system");
    if (systemMessages.length === 0) return void 0;
    return systemMessages.map((m) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return m.content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
      }
      return "";
    }).filter(Boolean).join("\n");
  }
  /** Return models from all registered providers. */
  async getAvailableModels() {
    const results = await Promise.all(
      this.providers.map(async (provider) => ({
        provider,
        available: await provider.isAvailable()
      }))
    );
    return results.filter((r) => r.available).flatMap((r) => r.provider.models);
  }
  /** Return model IDs for a specific provider. */
  getProviderModels(providerId) {
    const provider = this.providers.find((p) => p.id === providerId);
    if (!provider) return [];
    return provider.models.map((m) => m.id);
  }
  /** Return status information for each registered provider. */
  async getProviderStatuses() {
    const results = await Promise.all(
      this.providers.map(async (provider) => ({
        id: provider.id,
        name: provider.name,
        type: provider.type,
        available: await provider.isAvailable()
      }))
    );
    return results;
  }
  /**
   * Resolve the ordered list of candidate providers for a request.
   *
   * Resolution order:
   * 1. If `model` specified — provider with that model goes first
   * 2. If `provider` specified — that provider goes first
   * 3. Default: API providers first, then CLI providers
   */
  async resolveCandidates(request) {
    const availabilityResults = await Promise.all(
      this.providers.map(async (provider) => ({
        provider,
        available: await provider.isAvailable()
      }))
    );
    const available2 = availabilityResults.filter((r) => r.available).map((r) => r.provider);
    if (request.model) {
      const modelProvider = available2.find(
        (p) => p.models.some((m) => m.id === request.model)
      );
      if (modelProvider) {
        return [modelProvider, ...available2.filter((p) => p !== modelProvider)];
      }
      const corpus = available2.flatMap((p) => p.models.map((m) => m.id));
      const fuzzyResult = resolveModel(request.model, corpus);
      if (fuzzyResult) {
        const fuzzyProvider = available2.find(
          (p) => p.models.some((m) => m.id === fuzzyResult.match)
        );
        if (fuzzyProvider) {
          return [fuzzyProvider, ...available2.filter((p) => p !== fuzzyProvider)];
        }
      }
    }
    if (request.provider) {
      const preferred = available2.find((p) => p.id === request.provider);
      if (preferred) {
        return [preferred, ...available2.filter((p) => p !== preferred)];
      }
    }
    const sorted = available2.sort((a, b) => {
      if (a.type === "api" && b.type === "cli") return -1;
      if (a.type === "cli" && b.type === "api") return 1;
      return 0;
    });
    return this.reorderByLatency(sorted);
  }
  /**
   * Reorder candidates by latency measurements using epsilon-greedy strategy.
   *
   * - 90% of the time: pick the fastest provider (by latency data)
   * - 10% of the time: pick a random provider (exploration to prevent starvation)
   * - When no measurer is set or no latency data exists: return candidates unchanged
   */
  reorderByLatency(candidates) {
    if (!this._latencyMeasurer || candidates.length <= 1) {
      return candidates;
    }
    const measurements = this._latencyMeasurer.getAll();
    const latencyMap = buildLatencyMap(measurements);
    if (latencyMap.size === 0) {
      return candidates;
    }
    if (Math.random() < this._explorationRate) {
      const randomIndex = Math.floor(Math.random() * candidates.length);
      const picked = candidates[randomIndex];
      if (picked) {
        const rest = candidates.filter((_, i) => i !== randomIndex);
        return [picked, ...rest];
      }
    }
    const providerCandidates = candidates.map((p) => ({
      provider: p.id
    }));
    const selected = selectProviderWithLatency(providerCandidates, latencyMap, 0);
    const best = candidates.find((p) => p.id === selected.provider);
    if (best) {
      return [best, ...candidates.filter((p) => p !== best)];
    }
    return candidates;
  }
};

// src/core/session.ts
var DEFAULT_SWEEP_INTERVAL_MS = 6e4;
var SessionStore = class {
  sessions = /* @__PURE__ */ new Map();
  sweepTimer = null;
  constructor(sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS) {
    this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
    if (typeof this.sweepTimer === "object" && "unref" in this.sweepTimer) {
      this.sweepTimer.unref();
    }
  }
  /**
   * Build the session key from clientId and model.
   */
  key(clientId, model) {
    return `${clientId}:${model}`;
  }
  /**
   * Pin a client+model to a specific provider.
   *
   * @param clientId - The client identifier
   * @param model - The model being requested
   * @param provider - The provider to pin to
   * @param keyName - The key name (slot) on the provider
   * @param ttlMs - Time-to-live in milliseconds
   */
  pin(clientId, model, provider, keyName, ttlMs) {
    const k = this.key(clientId, model);
    this.sessions.set(k, {
      provider,
      keyName,
      expiresAt: Date.now() + ttlMs
    });
  }
  /**
   * Get the pinned provider for a client+model, or null if expired/missing.
   */
  get(clientId, model) {
    const k = this.key(clientId, model);
    const entry = this.sessions.get(k);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.sessions.delete(k);
      return null;
    }
    return { provider: entry.provider, keyName: entry.keyName };
  }
  /**
   * Remove a specific session pin.
   */
  unpin(clientId, model) {
    this.sessions.delete(this.key(clientId, model));
  }
  /**
   * Remove all expired entries. Called periodically by the sweep timer.
   */
  sweep() {
    const now = Date.now();
    for (const [key, entry] of this.sessions) {
      if (now >= entry.expiresAt) {
        this.sessions.delete(key);
      }
    }
  }
  /**
   * Number of active (non-expired) sessions.
   */
  get size() {
    return this.sessions.size;
  }
  /**
   * Destroy the store and clean up the sweep interval.
   * MUST be called to prevent interval leaks.
   */
  destroy() {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.sessions.clear();
  }
};

// src/core/transformer.ts
var TransformError = class extends Error {
  constructor(message, format, cause) {
    super(message);
    this.format = format;
    this.cause = cause;
    this.name = "TransformError";
  }
};
var TransformerRegistry = class {
  _inbound = [];
  _outbound = /* @__PURE__ */ new Map();
  _streamOutbound = /* @__PURE__ */ new Map();
  /** Register an inbound (format-detection) transformer. */
  registerInbound(transformer) {
    this._inbound.push(transformer);
  }
  /** Register an outbound transformer keyed by provider name. */
  registerOutbound(name, transformer) {
    this._outbound.set(name, transformer);
  }
  /** Register a streaming outbound transformer keyed by provider name. */
  registerStreamOutbound(name, transformer) {
    this._streamOutbound.set(name, transformer);
  }
  /**
   * Detect which inbound transformer matches the raw request.
   * Returns the first matching transformer, or null if none match.
   */
  detectInbound(rawRequest) {
    for (const t of this._inbound) {
      if (t.detect(rawRequest)) return t;
    }
    return null;
  }
  /**
   * Get an outbound transformer by provider name.
   * Returns null if no transformer is registered for that provider.
   */
  getOutbound(providerName) {
    return this._outbound.get(providerName) ?? null;
  }
  /**
   * Get a streaming outbound transformer by provider name.
   * Returns null if no streaming transformer is registered for that provider.
   */
  getStreamOutbound(providerName) {
    return this._streamOutbound.get(providerName) ?? null;
  }
  /** List all registered inbound format names. */
  get inboundFormats() {
    return this._inbound.map((t) => t.name);
  }
  /** List all registered outbound provider names. */
  get outboundProviders() {
    return [...this._outbound.keys()];
  }
};
var registry = new TransformerRegistry();

// src/crdt/g-counter.ts
var GCounter = class _GCounter {
  counts;
  constructor() {
    this.counts = /* @__PURE__ */ new Map();
  }
  /** Increment this node's counter by the given amount (default 1). */
  increment(nodeId, amount = 1) {
    if (amount < 0) {
      throw new Error("G-Counter only supports non-negative increments");
    }
    const current = this.counts.get(nodeId) ?? 0;
    this.counts.set(nodeId, current + amount);
  }
  /** Get the total value across all nodes. */
  value() {
    let total = 0;
    for (const count of this.counts.values()) {
      total += count;
    }
    return total;
  }
  /** Get the value for a specific node. */
  nodeValue(nodeId) {
    return this.counts.get(nodeId) ?? 0;
  }
  /** Merge another G-Counter into this one (max per node). */
  merge(other) {
    for (const [nodeId, otherCount] of other.counts.entries()) {
      const myCount = this.counts.get(nodeId) ?? 0;
      this.counts.set(nodeId, Math.max(myCount, otherCount));
    }
  }
  /** Serialize to a plain object. */
  serialize() {
    const counts = {};
    for (const [nodeId, count] of this.counts.entries()) {
      counts[nodeId] = count;
    }
    return { counts };
  }
  /** Create a GCounter from serialized state. */
  static fromState(state) {
    const counter = new _GCounter();
    for (const [nodeId, count] of Object.entries(state.counts)) {
      counter.counts.set(nodeId, count);
    }
    return counter;
  }
};

// src/crdt/lww-register.ts
var LWWRegister = class _LWWRegister {
  _value;
  _timestamp;
  _nodeId;
  constructor() {
    this._value = void 0;
    this._timestamp = 0;
    this._nodeId = "";
  }
  /** Set the register value with a timestamp and node identifier. */
  set(value, timestamp, nodeId) {
    if (timestamp > this._timestamp || timestamp === this._timestamp && nodeId > this._nodeId) {
      this._value = value;
      this._timestamp = timestamp;
      this._nodeId = nodeId;
    }
  }
  /** Get the current register value. */
  get() {
    return this._value;
  }
  /** Get the current timestamp. */
  get timestamp() {
    return this._timestamp;
  }
  /** Get the current node ID. */
  get nodeId() {
    return this._nodeId;
  }
  /** Merge another LWW-Register into this one. */
  merge(other) {
    this.set(other._value, other._timestamp, other._nodeId);
  }
  /** Serialize to a plain object. */
  serialize() {
    return {
      value: this._value,
      timestamp: this._timestamp,
      nodeId: this._nodeId
    };
  }
  /** Create a LWWRegister from serialized state. */
  static fromState(state) {
    const register2 = new _LWWRegister();
    register2._value = state.value;
    register2._timestamp = state.timestamp;
    register2._nodeId = state.nodeId;
    return register2;
  }
};

// src/crdt/or-set.ts
var ORSet = class _ORSet {
  /** element → set of live tags */
  elements;
  /** nodeId → current sequence counter */
  seqCounters;
  constructor() {
    this.elements = /* @__PURE__ */ new Map();
    this.seqCounters = /* @__PURE__ */ new Map();
  }
  /** Add an element. Returns the generated tag. */
  add(element, nodeId) {
    const seq = (this.seqCounters.get(nodeId) ?? 0) + 1;
    this.seqCounters.set(nodeId, seq);
    const tag = { nodeId, seq };
    const existing = this.elements.get(element) ?? [];
    existing.push(tag);
    this.elements.set(element, existing);
    return tag;
  }
  /** Remove an element by removing all its currently observed tags. */
  remove(element) {
    this.elements.delete(element);
  }
  /** List all elements currently in the set. */
  list() {
    const result = [];
    for (const [element, tags] of this.elements.entries()) {
      if (tags.length > 0) {
        result.push(element);
      }
    }
    return result;
  }
  /** Check if an element is in the set. */
  has(element) {
    const tags = this.elements.get(element);
    return tags !== void 0 && tags.length > 0;
  }
  /** Merge another OR-Set into this one. */
  merge(other) {
    for (const [element, otherTags] of other.elements.entries()) {
      const myTags = this.elements.get(element) ?? [];
      for (const otherTag of otherTags) {
        const alreadyHave = myTags.some(
          (t) => t.nodeId === otherTag.nodeId && t.seq === otherTag.seq
        );
        if (!alreadyHave) {
          myTags.push(otherTag);
        }
      }
      if (myTags.length > 0) {
        this.elements.set(element, myTags);
      }
    }
    for (const [nodeId, seq] of other.seqCounters.entries()) {
      const mySeq = this.seqCounters.get(nodeId) ?? 0;
      this.seqCounters.set(nodeId, Math.max(mySeq, seq));
    }
  }
  /** Serialize to a plain object. */
  serialize() {
    const entries = {};
    for (const [element, tags] of this.elements.entries()) {
      if (tags.length > 0) {
        entries[element] = tags.map((t) => ({ nodeId: t.nodeId, seq: t.seq }));
      }
    }
    return { entries };
  }
  /** Create an ORSet from serialized state. */
  static fromState(state) {
    const set = new _ORSet();
    for (const [element, tags] of Object.entries(state.entries)) {
      set.elements.set(element, [...tags]);
      for (const tag of tags) {
        const current = set.seqCounters.get(tag.nodeId) ?? 0;
        if (tag.seq > current) {
          set.seqCounters.set(tag.nodeId, tag.seq);
        }
      }
    }
    return set;
  }
};

// src/crdt/state-manager.ts
var StateManager = class {
  containers;
  constructor() {
    this.containers = /* @__PURE__ */ new Map();
  }
  /** Write to a named container, creating it if needed. */
  write(key, type, args) {
    let entry = this.containers.get(key);
    if (!entry) {
      entry = { type, instance: this.createInstance(type) };
      this.containers.set(key, entry);
    }
    if (entry.type !== type) {
      throw new Error(
        `Type mismatch for key "${key}": existing=${entry.type}, requested=${type}`
      );
    }
    this.applyWrite(entry.instance, type, args);
  }
  /** Read the current value from a named container. */
  read(key) {
    const entry = this.containers.get(key);
    if (!entry) return null;
    return {
      type: entry.type,
      value: this.readValue(entry.instance, entry.type)
    };
  }
  /** List all container keys with their types. */
  list() {
    return Array.from(this.containers.entries()).map(([key, entry]) => ({
      key,
      type: entry.type
    }));
  }
  /** Create a snapshot of all containers. */
  snapshot() {
    const entries = {};
    for (const [key, entry] of this.containers.entries()) {
      entries[key] = {
        type: entry.type,
        state: this.serializeInstance(entry.instance, entry.type)
      };
    }
    return { entries };
  }
  /** Merge an incoming snapshot into this manager's state. */
  mergeSnapshot(incoming) {
    for (const [key, value] of Object.entries(incoming.entries)) {
      const existing = this.containers.get(key);
      const incomingInstance = this.deserializeInstance(value.type, value.state);
      if (!existing) {
        this.containers.set(key, { type: value.type, instance: incomingInstance });
        continue;
      }
      if (existing.type !== value.type) {
        throw new Error(
          `Type mismatch on merge for key "${key}": local=${existing.type}, remote=${value.type}`
        );
      }
      this.mergeInstances(existing.instance, incomingInstance, existing.type);
    }
  }
  // ── Private helpers ──
  createInstance(type) {
    switch (type) {
      case "g-counter":
        return new GCounter();
      case "lww-register":
        return new LWWRegister();
      case "or-set":
        return new ORSet();
    }
  }
  applyWrite(instance, type, args) {
    switch (type) {
      case "g-counter": {
        const a = args;
        instance.increment(a.nodeId, a.amount ?? 1);
        break;
      }
      case "lww-register": {
        const a = args;
        instance.set(
          a.value,
          a.timestamp ?? Date.now(),
          a.nodeId
        );
        break;
      }
      case "or-set": {
        const a = args;
        if (a.action === "add") {
          if (!a.nodeId) throw new Error("nodeId required for or-set add");
          instance.add(a.element, a.nodeId);
        } else {
          instance.remove(a.element);
        }
        break;
      }
    }
  }
  readValue(instance, type) {
    switch (type) {
      case "g-counter":
        return instance.value();
      case "lww-register":
        return instance.get();
      case "or-set":
        return instance.list();
    }
  }
  serializeInstance(instance, type) {
    switch (type) {
      case "g-counter":
        return instance.serialize();
      case "lww-register":
        return instance.serialize();
      case "or-set":
        return instance.serialize();
    }
  }
  deserializeInstance(type, state) {
    switch (type) {
      case "g-counter":
        return GCounter.fromState(state);
      case "lww-register":
        return LWWRegister.fromState(state);
      case "or-set":
        return ORSet.fromState(state);
    }
  }
  mergeInstances(local, remote, type) {
    switch (type) {
      case "g-counter":
        local.merge(remote);
        break;
      case "lww-register":
        local.merge(remote);
        break;
      case "or-set":
        local.merge(remote);
        break;
    }
  }
};

// src/free-models/registry.ts
import { existsSync as existsSync7, readFileSync as readFileSync5 } from "fs";
import { join as join6, dirname as dirname5 } from "path";
import { fileURLToPath } from "url";
import { homedir as homedir3 } from "os";
var FREE_MODELS_CONFIG_PATH = join6(homedir3(), ".llm-gateway", "free-models.json");
var BUILTIN_FREE_MODELS = [
  {
    id: "openrouter-free-llama-3.1-8b",
    name: "Llama 3.1 8B (OpenRouter Free)",
    source: "openrouter-free",
    baseUrl: "https://openrouter.ai/api/v1",
    modelId: "meta-llama/llama-3.1-8b-instruct:free",
    capabilities: ["chat", "code"],
    maxTokens: 8192,
    apiKeyEnv: "OPENROUTER_API_KEY",
    enabled: true
  },
  {
    id: "openrouter-free-gemma-2-9b",
    name: "Gemma 2 9B (OpenRouter Free)",
    source: "openrouter-free",
    baseUrl: "https://openrouter.ai/api/v1",
    modelId: "google/gemma-2-9b-it:free",
    capabilities: ["chat", "code"],
    maxTokens: 8192,
    apiKeyEnv: "OPENROUTER_API_KEY",
    enabled: true
  },
  {
    id: "openrouter-free-qwen-2.5-7b",
    name: "Qwen 2.5 7B (OpenRouter Free)",
    source: "openrouter-free",
    baseUrl: "https://openrouter.ai/api/v1",
    modelId: "qwen/qwen-2.5-7b-instruct:free",
    capabilities: ["chat", "code", "reasoning"],
    maxTokens: 8192,
    apiKeyEnv: "OPENROUTER_API_KEY",
    enabled: true
  },
  {
    id: "nvidia-nim-llama-3.1-8b",
    name: "Llama 3.1 8B (NVIDIA NIM)",
    source: "nvidia-nim",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    modelId: "meta/llama-3.1-8b-instruct",
    capabilities: ["chat", "code"],
    maxTokens: 8192,
    apiKeyEnv: "NVIDIA_API_KEY",
    enabled: true
  },
  {
    id: "huggingface-zephyr-7b",
    name: "Zephyr 7B (HuggingFace)",
    source: "huggingface",
    baseUrl: "https://api-inference.huggingface.co/models/HuggingFaceH4/zephyr-7b-beta/v1",
    modelId: "HuggingFaceH4/zephyr-7b-beta",
    capabilities: ["chat"],
    maxTokens: 4096,
    apiKeyEnv: "HF_API_KEY",
    enabled: true
  }
];
function validateEntry(entry) {
  const errors = [];
  if (typeof entry !== "object" || entry === null) {
    return ["Entry must be an object"];
  }
  const e = entry;
  if (typeof e["id"] !== "string" || e["id"] === "") errors.push("id must be a non-empty string");
  if (typeof e["name"] !== "string" || e["name"] === "") errors.push("name must be a non-empty string");
  if (typeof e["source"] !== "string") errors.push("source must be a string");
  if (typeof e["baseUrl"] !== "string" || !e["baseUrl"]) errors.push("baseUrl must be a non-empty string");
  if (typeof e["modelId"] !== "string" || !e["modelId"]) errors.push("modelId must be a non-empty string");
  if (!Array.isArray(e["capabilities"])) errors.push("capabilities must be an array");
  if (typeof e["maxTokens"] !== "number" || e["maxTokens"] <= 0) errors.push("maxTokens must be a positive number");
  return errors;
}
function loadUserModels(configPath) {
  const path = configPath ?? FREE_MODELS_CONFIG_PATH;
  if (!existsSync7(path)) {
    return [];
  }
  try {
    const content = readFileSync5(path, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed.models || !Array.isArray(parsed.models)) {
      logger.warn({ path }, 'free-models.json missing "models" array');
      return [];
    }
    const valid = [];
    for (const raw of parsed.models) {
      const errors = validateEntry(raw);
      if (errors.length > 0) {
        logger.warn({ errors, entry: raw }, "Skipping invalid free model entry");
        continue;
      }
      const entry = raw;
      if (typeof entry.enabled !== "boolean") {
        entry.enabled = true;
      }
      valid.push(entry);
    }
    logger.info({ count: valid.length, path }, "Loaded user-defined free models");
    return valid;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ error: message, path }, "Failed to load free-models.json");
    return [];
  }
}
var FreeModelRegistry = class {
  models;
  /**
   * @param userModels  User-defined model entries
   * @param skipBuiltins When true, do NOT load built-in models (use only userModels)
   */
  constructor(userModels = [], skipBuiltins = false) {
    this.models = /* @__PURE__ */ new Map();
    if (!skipBuiltins) {
      for (const model of BUILTIN_FREE_MODELS) {
        this.models.set(model.id, model);
      }
    }
    for (const model of userModels) {
      this.models.set(model.id, model);
    }
  }
  /** Get all enabled models. */
  getEnabled() {
    return [...this.models.values()].filter((m) => m.enabled);
  }
  /** Get all models (including disabled). */
  getAll() {
    return [...this.models.values()];
  }
  /** Get a model by ID. */
  get(id) {
    return this.models.get(id);
  }
  /** Filter models by capability. */
  getByCapability(capability) {
    return this.getEnabled().filter((m) => m.capabilities.includes(capability));
  }
  /** Total count of registered models. */
  get size() {
    return this.models.size;
  }
  /**
   * Bulk-import models into the registry.
   * New entries are added; existing IDs are updated (overwritten).
   */
  importModels(entries) {
    let count = 0;
    for (const entry of entries) {
      this.models.set(entry.id, entry);
      count++;
    }
    return count;
  }
  /** Clear all models from the registry. */
  clear() {
    this.models.clear();
  }
};
function parseContextWindow(ctx) {
  const normalized = ctx.trim().toLowerCase();
  const match = normalized.match(/^([\d.]+)\s*([km]?)$/);
  if (!match) return 8192;
  const value = parseFloat(match[1]);
  const unit = match[2];
  if (unit === "m") return Math.round(value * 1e6);
  if (unit === "k") return Math.round(value * 1e3);
  return Math.round(value);
}
function tierToBaseStability(tier) {
  const map = {
    "S+": 90,
    "S": 80,
    "A+": 70,
    "A": 60,
    "A-": 55,
    "B+": 45,
    "B": 35,
    "C": 20
  };
  return map[tier] ?? 50;
}
function computeStabilityScore(tier, sweScore, modelId, healthChecker) {
  const baseScore = tierToBaseStability(tier);
  const sweNormalized = Math.max(0, Math.min(100, sweScore));
  let score = baseScore * 0.6 + sweNormalized * 0.4;
  if (healthChecker && modelId) {
    const reliability = healthChecker.getReliability(modelId);
    if (reliability !== 0.5) {
      const reliabilityScore = reliability * 100;
      score = score * 0.6 + reliabilityScore * 0.4;
    }
  }
  return Math.round(Math.max(0, Math.min(100, score)));
}
function inferCapabilities(model) {
  const capabilities = ["chat"];
  const nameLower = (model.displayName + " " + model.modelId).toLowerCase();
  if (nameLower.includes("coder") || nameLower.includes("codestral") || nameLower.includes("code") || model.sweScore >= 30) {
    capabilities.push("code");
  }
  if (nameLower.includes("reasoning") || nameLower.includes("thinking") || nameLower.includes("r1") || nameLower.includes("qwq")) {
    capabilities.push("reasoning");
  }
  return capabilities;
}
function catalogEntryId(sourceKey, modelId) {
  const slug = modelId.replace(/[:@/]/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `catalog-${sourceKey}-${slug}`;
}
function importProviderModels(provider, healthChecker) {
  const entries = [];
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (const model of provider.models) {
    const id = catalogEntryId(provider.sourceKey, model.modelId);
    const stabilityScore = computeStabilityScore(
      model.tier,
      model.sweScore,
      id,
      healthChecker
    );
    entries.push({
      id,
      name: `${model.displayName} (${provider.sourceKey})`,
      source: provider.sourceKey,
      baseUrl: provider.baseUrl,
      modelId: model.modelId,
      capabilities: inferCapabilities(model),
      maxTokens: parseContextWindow(model.contextWindow),
      apiKeyEnv: provider.envKey,
      enabled: true,
      stabilityScore,
      lastStabilityCheck: now
    });
  }
  return entries;
}
function importCatalog(catalog, healthChecker) {
  const allEntries = [];
  for (const provider of catalog.providers) {
    const entries = importProviderModels(provider, healthChecker);
    allEntries.push(...entries);
  }
  logger.info(
    { modelCount: allEntries.length, providers: catalog.providers.length, version: catalog.version },
    "Imported free model catalog"
  );
  return allEntries;
}
function loadCatalog(catalogPath) {
  const defaultPath = join6(dirname5(fileURLToPath(import.meta.url)), "catalog.json");
  const path = catalogPath ?? defaultPath;
  if (!existsSync7(path)) {
    logger.warn({ path }, "Catalog file not found");
    return null;
  }
  try {
    const content = readFileSync5(path, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed.providers || !Array.isArray(parsed.providers)) {
      logger.warn({ path }, "Invalid catalog: missing providers array");
      return null;
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ error: message, path }, "Failed to load catalog");
    return null;
  }
}

// src/free-models/health.ts
async function checkHealth(entry, timeoutMs = 5e3) {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const apiKey = entry.apiKeyEnv ? process.env[entry.apiKeyEnv] : void 0;
    const headers = {
      "Content-Type": "application/json"
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    const url = `${entry.baseUrl}/models`;
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal
    });
    const latencyMs = Date.now() - start;
    let status;
    if (response.ok) {
      status = "healthy";
    } else if (response.status === 429) {
      status = "degraded";
    } else {
      status = "down";
    }
    return {
      modelId: entry.id,
      status,
      latencyMs,
      lastChecked: (/* @__PURE__ */ new Date()).toISOString(),
      error: response.ok ? void 0 : `HTTP ${response.status}`
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = message.includes("abort");
    return {
      modelId: entry.id,
      status: "down",
      latencyMs: isTimeout ? null : latencyMs,
      lastChecked: (/* @__PURE__ */ new Date()).toISOString(),
      error: isTimeout ? `Timeout after ${timeoutMs}ms` : message
    };
  } finally {
    clearTimeout(timer);
  }
}
var HealthChecker = class {
  constructor(timeoutMs = 5e3) {
    this.timeoutMs = timeoutMs;
  }
  results = /* @__PURE__ */ new Map();
  successHistory = /* @__PURE__ */ new Map();
  intervalHandle = null;
  historySize = 10;
  /** Get the latest health result for a model. */
  getHealth(modelId) {
    return this.results.get(modelId);
  }
  /** Get all cached health results. */
  getAllHealth() {
    return new Map(this.results);
  }
  /**
   * Get the reliability score for a model (0-1).
   * Based on the rolling success rate over the last N checks.
   * Returns 0.5 if no history (unknown models get neutral score).
   */
  getReliability(modelId) {
    const history = this.successHistory.get(modelId);
    if (!history || history.length === 0) return 0.5;
    const successes = history.filter(Boolean).length;
    return successes / history.length;
  }
  /**
   * Check health for a batch of models.
   * Runs checks in parallel for efficiency.
   */
  async checkAll(entries) {
    const results = await Promise.all(
      entries.map((entry) => checkHealth(entry, this.timeoutMs))
    );
    for (const result of results) {
      this.results.set(result.modelId, result);
      this.recordHistory(result.modelId, result.status === "healthy" || result.status === "degraded");
    }
    return results;
  }
  /**
   * Start periodic health checks.
   * @param entries Models to check
   * @param intervalSec Check interval in seconds
   */
  startPeriodicChecks(entries, intervalSec) {
    this.stopPeriodicChecks();
    void this.checkAll(entries).catch((error) => {
      logger.warn({ error }, "Free model health check failed");
    });
    this.intervalHandle = setInterval(() => {
      void this.checkAll(entries).catch((error) => {
        logger.warn({ error }, "Free model periodic health check failed");
      });
    }, intervalSec * 1e3);
    if (this.intervalHandle && typeof this.intervalHandle === "object" && "unref" in this.intervalHandle) {
      this.intervalHandle.unref();
    }
  }
  /** Stop periodic health checks. */
  stopPeriodicChecks() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
  /** Clean up resources. */
  destroy() {
    this.stopPeriodicChecks();
    this.results.clear();
    this.successHistory.clear();
  }
  /** Record a success/failure entry in rolling history. */
  recordHistory(modelId, success) {
    let history = this.successHistory.get(modelId);
    if (!history) {
      history = [];
      this.successHistory.set(modelId, history);
    }
    history.push(success);
    if (history.length > this.historySize) {
      history.splice(0, history.length - this.historySize);
    }
  }
};

// src/free-models/ranker.ts
var WEIGHTS = {
  latency: 0.4,
  reliability: 0.35,
  capability: 0.25
};
var MAX_ACCEPTABLE_LATENCY_MS = 1e4;
function scoreLatency(latencyMs) {
  if (latencyMs === null || latencyMs < 0) return 0;
  if (latencyMs >= MAX_ACCEPTABLE_LATENCY_MS) return 0;
  return Math.round((1 - latencyMs / MAX_ACCEPTABLE_LATENCY_MS) * 100);
}
function scoreReliability(reliability) {
  return Math.round(Math.max(0, Math.min(1, reliability)) * 100);
}
function scoreCapability(modelCapabilities, requiredCapabilities) {
  if (requiredCapabilities.length === 0) return 100;
  const matched = requiredCapabilities.filter(
    (c) => modelCapabilities.includes(c)
  ).length;
  return Math.round(matched / requiredCapabilities.length * 100);
}
function computeScore(latencyScore, reliabilityScore, capabilityScore) {
  return Math.round(
    latencyScore * WEIGHTS.latency + reliabilityScore * WEIGHTS.reliability + capabilityScore * WEIGHTS.capability
  );
}
function rankModels(entries, healthChecker, requiredCapabilities = []) {
  const ranked = [];
  for (const entry of entries) {
    const health = healthChecker.getHealth(entry.id) ?? {
      modelId: entry.id,
      status: "unknown",
      latencyMs: null,
      lastChecked: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (health.status === "down") continue;
    const latencyScore = scoreLatency(health.latencyMs);
    const reliabilityScore = scoreReliability(healthChecker.getReliability(entry.id));
    const capabilityScore = scoreCapability(entry.capabilities, requiredCapabilities);
    const score = computeScore(latencyScore, reliabilityScore, capabilityScore);
    ranked.push({
      entry,
      health,
      score,
      breakdown: {
        latencyScore,
        reliabilityScore,
        capabilityScore
      }
    });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

// src/free-models/types.ts
var DEFAULT_FREE_MODEL_CONFIG = {
  enabled: false,
  healthCheckIntervalSec: 60,
  healthCheckTimeoutMs: 5e3,
  maxRetries: 3,
  models: []
};

// src/free-models/router.ts
var FreeModelRouter = class {
  registry;
  healthChecker;
  config;
  constructor(config2 = {}) {
    this.config = { ...DEFAULT_FREE_MODEL_CONFIG, ...config2 };
    if (this.config.models.length > 0) {
      this.registry = new FreeModelRegistry(this.config.models, true);
    } else {
      const userModels = loadUserModels();
      this.registry = new FreeModelRegistry(userModels);
    }
    this.healthChecker = new HealthChecker(this.config.healthCheckTimeoutMs);
    if (this.config.enabled) {
      this.startHealthChecks();
    }
  }
  /** Start periodic health monitoring. */
  startHealthChecks() {
    const enabled = this.registry.getEnabled();
    if (enabled.length === 0) {
      logger.warn("Free model routing enabled but no models registered");
      return;
    }
    logger.info(
      { modelCount: enabled.length, intervalSec: this.config.healthCheckIntervalSec },
      "Starting free model health checks"
    );
    this.healthChecker.startPeriodicChecks(
      enabled,
      this.config.healthCheckIntervalSec
    );
  }
  /**
   * Attempt to generate a response using the best available free model.
   *
   * Ranks available models, then tries them in order until one succeeds
   * or maxRetries is exhausted.
   *
   * @param request Original generate request
   * @param requiredCapabilities Capabilities the request needs
   * @returns GenerateResponse from the free model, or throws if all fail
   */
  async generate(request, requiredCapabilities = []) {
    const startTime = Date.now();
    const ranked = rankModels(
      this.registry.getEnabled(),
      this.healthChecker,
      requiredCapabilities
    );
    if (ranked.length === 0) {
      throw new Error("No free models available (all down or none registered)");
    }
    const candidates = ranked.slice(0, this.config.maxRetries);
    const errors = [];
    for (const [index, candidate] of candidates.entries()) {
      try {
        const response = await this.callModel(candidate.entry, request);
        const latencyMs = Date.now() - startTime;
        logger.info(
          {
            model: candidate.entry.id,
            score: candidate.score,
            latencyMs,
            fallbackUsed: index > 0
          },
          "Free model request succeeded"
        );
        return {
          text: response,
          provider: `free:${candidate.entry.source}`,
          model: candidate.entry.modelId,
          resolvedProvider: `free:${candidate.entry.source}`,
          resolvedModel: candidate.entry.modelId,
          fallbackUsed: index > 0,
          latencyMs
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          { model: candidate.entry.id, error: message },
          "Free model request failed, trying next"
        );
        errors.push(`${candidate.entry.id}: ${message}`);
        continue;
      }
    }
    throw new Error(
      `All free models failed (tried ${candidates.length}).
${errors.join("\n")}`
    );
  }
  /**
   * Call a single free model endpoint using OpenAI-compatible format.
   * Returns the generated text content.
   */
  async callModel(entry, request) {
    const apiKey = entry.apiKeyEnv ? process.env[entry.apiKeyEnv] : void 0;
    const headers = {
      "Content-Type": "application/json"
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    const messages = [];
    if (request.system) {
      messages.push({ role: "system", content: request.system });
    }
    messages.push({ role: "user", content: request.prompt });
    const body = JSON.stringify({
      model: entry.modelId,
      messages,
      max_tokens: request.maxTokens ?? Math.min(entry.maxTokens, 4096)
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3e4);
    try {
      const response = await fetch(`${entry.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body,
        signal: controller.signal
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      }
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from free model");
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
  /** Get the registry for inspection. */
  getRegistry() {
    return this.registry;
  }
  /** Get the health checker for inspection. */
  getHealthChecker() {
    return this.healthChecker;
  }
  /** Whether the router is enabled and has models. */
  get isAvailable() {
    return this.config.enabled && this.registry.getEnabled().length > 0;
  }
  /** Clean up resources. */
  destroy() {
    this.healthChecker.destroy();
  }
};

// src/latency/measurer.ts
var DEFAULT_TTL_MS = 2 * 60 * 60 * 1e3;
var DEFAULT_INTERVAL_MS = 60 * 60 * 1e3;
var MEASUREMENT_TIMEOUT_MS = 1e4;
var LatencyMeasurer = class {
  measurements;
  ttlMs;
  intervalId = null;
  /**
   * Create a new LatencyMeasurer.
   * @param ttlMs - Time-to-live for cached measurements (default: 2 hours)
   */
  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.measurements = /* @__PURE__ */ new Map();
    this.ttlMs = ttlMs;
  }
  /**
   * Measure latency for a provider endpoint.
   * Performs a HEAD request and records the response time.
   * @param provider - Provider identifier
   * @param url - URL to measure
   * @returns Latency in milliseconds, or -1 if measurement failed
   */
  async measure(provider, url) {
    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), MEASUREMENT_TIMEOUT_MS);
      await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
        // Prevent following redirects to avoid measuring wrong endpoint
        redirect: "manual"
      });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;
      const measurement = {
        provider,
        url,
        latencyMs,
        measuredAt: Date.now()
      };
      this.measurements.set(provider, measurement);
      return latencyMs;
    } catch {
      const measurement = {
        provider,
        url,
        latencyMs: -1,
        measuredAt: Date.now()
      };
      this.measurements.set(provider, measurement);
      return -1;
    }
  }
  /**
   * Get cached measurement for a provider.
   * Returns null if no measurement exists or if it has expired.
   * @param provider - Provider identifier
   * @returns The measurement or null
   */
  get(provider) {
    const measurement = this.measurements.get(provider);
    if (!measurement) {
      return null;
    }
    if (Date.now() - measurement.measuredAt > this.ttlMs) {
      return null;
    }
    return measurement;
  }
  /**
   * Get all non-expired measurements.
   * @returns Array of latency measurements
   */
  getAll() {
    const now = Date.now();
    const result = [];
    for (const measurement of this.measurements.values()) {
      if (now - measurement.measuredAt <= this.ttlMs) {
        result.push(measurement);
      }
    }
    return result;
  }
  /**
   * Remove expired measurements from the cache.
   * Call this periodically to prevent memory growth.
   */
  cleanup() {
    const now = Date.now();
    for (const [provider, measurement] of this.measurements.entries()) {
      if (now - measurement.measuredAt > this.ttlMs) {
        this.measurements.delete(provider);
      }
    }
  }
  /**
   * Start background measurement task.
   * Measures all providers every hour (configurable).
   * @param providers - Array of provider configurations to measure
   * @param intervalMs - Measurement interval in milliseconds (default: 1 hour)
   */
  startBackgroundTask(providers, intervalMs = DEFAULT_INTERVAL_MS) {
    this.stopBackgroundTask();
    void this.measureAll(providers);
    this.intervalId = setInterval(() => {
      void this.measureAll(providers);
    }, intervalMs);
  }
  /**
   * Stop the background measurement task.
   */
  stopBackgroundTask() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  /**
   * Measure all configured providers.
   * @param providers - Array of provider configurations
   */
  async measureAll(providers) {
    for (const provider of providers) {
      if (provider.baseUrl) {
        await this.measure(provider.id, provider.baseUrl);
      }
    }
  }
  /**
   * Check if a measurement is stale (older than TTL).
   * @param provider - Provider identifier
   * @returns True if stale or not found
   */
  isStale(provider) {
    const measurement = this.measurements.get(provider);
    if (!measurement) {
      return true;
    }
    return Date.now() - measurement.measuredAt > this.ttlMs;
  }
  /**
   * Get the number of cached measurements.
   * @returns Count of measurements (including expired)
   */
  size() {
    return this.measurements.size;
  }
  /**
   * Clear all measurements.
   */
  clear() {
    this.measurements.clear();
  }
};

// src/server/http.ts
import { randomBytes as randomBytes3, randomUUID as randomUUID3, timingSafeEqual as timingSafeEqual3 } from "crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";

// src/auth/keys.ts
import { randomBytes as randomBytes2, createHash, timingSafeEqual } from "crypto";
import { randomUUID as randomUUID2 } from "crypto";

// src/auth/types.ts
var API_KEY_PREFIX = "mlb_sk_";
var API_KEY_HEX_LENGTH = 32;

// src/auth/keys.ts
function generateApiKey() {
  const hexPart = randomBytes2(API_KEY_HEX_LENGTH / 2).toString("hex");
  const key = `${API_KEY_PREFIX}${hexPart}`;
  const hash = hashApiKey(key);
  const prefix = key.slice(0, API_KEY_PREFIX.length + 8);
  return { key, hash, prefix };
}
function hashApiKey(key) {
  return createHash("sha256").update(key, "utf8").digest("hex");
}
function rowToApiKey(row) {
  return {
    id: row.id,
    keyHash: row.key_hash,
    keyPrefix: row.key_prefix,
    userId: row.user_id,
    project: row.project,
    trustLevel: row.trust_level,
    rateLimitMax: row.rate_limit_max,
    rateLimitWindowMs: row.rate_limit_window_ms,
    budgetUsd: row.budget_usd,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}
function createApiKey(db2, opts) {
  const { key, hash, prefix } = generateApiKey();
  const id = randomUUID2();
  const stmt = db2.prepare(`
    INSERT INTO api_keys (id, key_hash, key_prefix, user_id, project, trust_level,
      rate_limit_max, rate_limit_window_ms, budget_usd, enabled, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);
  stmt.run(
    id,
    hash,
    prefix,
    opts.userId,
    opts.project ?? null,
    opts.trustLevel ?? "restricted",
    opts.rateLimitMax ?? 100,
    opts.rateLimitWindowMs ?? 9e5,
    opts.budgetUsd ?? 0,
    opts.expiresAt ?? null
  );
  const row = db2.prepare("SELECT * FROM api_keys WHERE id = ?").get(id);
  if (!row) {
    throw new Error("Failed to create API key \u2014 row not found after insert");
  }
  return { apiKey: rowToApiKey(row), plaintextKey: key };
}
function revokeApiKey(db2, id) {
  const result = db2.prepare("UPDATE api_keys SET enabled = 0 WHERE id = ?").run(id);
  return result.changes > 0;
}
function lookupByHash(db2, hash) {
  const row = db2.prepare("SELECT * FROM api_keys WHERE key_hash = ?").get(hash);
  if (!row) return null;
  const storedBuf = Buffer.from(row.key_hash, "utf8");
  const lookupBuf = Buffer.from(hash, "utf8");
  if (storedBuf.length !== lookupBuf.length) return null;
  if (!timingSafeEqual(storedBuf, lookupBuf)) return null;
  return rowToApiKey(row);
}
function listApiKeys(db2, userId) {
  if (userId) {
    const rows2 = db2.prepare(
      "SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC"
    ).all(userId);
    return rows2.map(rowToApiKey);
  }
  const rows = db2.prepare("SELECT * FROM api_keys ORDER BY created_at DESC").all();
  return rows.map(rowToApiKey);
}

// src/auth/quotas.ts
function checkRateLimit(db2, apiKeyId, config2) {
  const d = new Date(Date.now() - config2.windowMs);
  const windowStart = d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
  const row = db2.prepare(
    `SELECT COUNT(*) as cnt, MIN(created_at) as oldest_at
       FROM usage_logs
       WHERE key_name = ? AND created_at >= ?`
  ).get(apiKeyId, windowStart);
  const count = row?.cnt ?? 0;
  if (count >= config2.max) {
    const oldestAt = row?.oldest_at ? new Date(row.oldest_at).getTime() : Date.now();
    const windowEnd = oldestAt + config2.windowMs;
    const retryAfter = Math.max(0, windowEnd - Date.now());
    return { allowed: false, retryAfter };
  }
  return { allowed: true };
}
function checkBudget(costTracker2, userId, budgetUsd) {
  if (budgetUsd <= 0) {
    return { allowed: true, remaining: Infinity };
  }
  const now = /* @__PURE__ */ new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const summary = costTracker2.summary({
    from: monthStart,
    to: now.toISOString()
  });
  void userId;
  const used = summary.totalCostUsd;
  const remaining = Math.max(0, budgetUsd - used);
  return {
    allowed: remaining > 0,
    remaining
  };
}

// src/auth/middleware.ts
function apiKeyAuth(db2, costTracker2) {
  return async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json({ error: "Unauthorized", code: "MISSING_AUTH" }, 401);
    }
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
      return c.json({ error: "Unauthorized", code: "INVALID_AUTH_FORMAT" }, 401);
    }
    const token = parts[1];
    const hash = hashApiKey(token);
    const apiKey = lookupByHash(db2, hash);
    if (!apiKey) {
      return c.json({ error: "Unauthorized", code: "INVALID_KEY" }, 401);
    }
    if (!apiKey.enabled) {
      return c.json({ error: "Unauthorized", code: "KEY_REVOKED" }, 401);
    }
    if (apiKey.expiresAt) {
      const expiresAt = new Date(apiKey.expiresAt).getTime();
      if (Date.now() >= expiresAt) {
        return c.json({ error: "Unauthorized", code: "KEY_EXPIRED" }, 401);
      }
    }
    const rateLimitResult = checkRateLimit(db2, apiKey.id, {
      max: apiKey.rateLimitMax,
      windowMs: apiKey.rateLimitWindowMs
    });
    if (!rateLimitResult.allowed) {
      const retryAfterSec = Math.ceil((rateLimitResult.retryAfter ?? 0) / 1e3);
      c.header("Retry-After", String(retryAfterSec));
      return c.json(
        { error: "Too many requests", code: "RATE_LIMITED", retryAfter: retryAfterSec },
        429
      );
    }
    if (costTracker2 && apiKey.budgetUsd > 0) {
      const budgetResult = checkBudget(costTracker2, apiKey.userId, apiKey.budgetUsd);
      if (!budgetResult.allowed) {
        return c.json(
          { error: "Budget exceeded", code: "BUDGET_EXCEEDED", remaining: budgetResult.remaining },
          403
        );
      }
      if (budgetResult.remaining < apiKey.budgetUsd * 0.2) {
        c.header("X-Budget-Remaining", budgetResult.remaining.toFixed(4));
      }
    }
    const userContext = {
      userId: apiKey.userId,
      apiKeyId: apiKey.id,
      trustLevel: apiKey.trustLevel,
      project: apiKey.project
    };
    c.set("userContext", userContext);
    return next();
  };
}

// src/comparison/schemas.ts
import { z as z2 } from "zod";
var CompareRequestSchema = z2.object({
  prompt: z2.string().min(1, "prompt is required").max(
    MAX_PROMPT_LENGTH,
    `prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`
  ),
  system: z2.string().optional(),
  models: z2.array(z2.string()).min(2, "models must have at least 2 items").max(5, "models must have at most 5 items").refine((models) => new Set(models).size === models.length, {
    message: "duplicate models not allowed"
  }),
  maxTokens: z2.number().int().positive().optional().default(1024),
  timeoutMs: z2.number().int().positive().max(12e4, "timeoutMs must be at most 120000").optional().default(3e4),
  maxEstimatedCost: z2.number().positive().optional(),
  persist: z2.boolean().optional().default(false),
  project: z2.string().optional()
});
var ModelResultSchema = z2.object({
  model: z2.string(),
  provider: z2.string(),
  status: z2.enum(["success", "error", "timeout"]),
  response: z2.string().optional(),
  error: z2.string().optional(),
  tokensIn: z2.number().int().nonnegative(),
  tokensOut: z2.number().int().nonnegative(),
  costUsd: z2.number(),
  latencyMs: z2.number(),
  finishReason: z2.string().optional(),
  stabilityScore: z2.number().optional()
});
var ComparisonSummarySchema = z2.object({
  fastestModel: z2.string().optional(),
  cheapestModel: z2.string().optional(),
  totalCost: z2.number(),
  wallClockMs: z2.number()
});
var CompareResponseSchema = z2.object({
  id: z2.string(),
  prompt: z2.string(),
  results: z2.array(ModelResultSchema),
  summary: ComparisonSummarySchema,
  createdAt: z2.string()
});

// src/core/circuit-breaker.ts
var DEFAULT_CONFIG3 = {
  failureThreshold: 5,
  resetTimeoutMs: 3e4,
  halfOpenSuccessThreshold: 2,
  backoffBaseMs: null,
  // null = use fixed resetTimeoutMs (backward compat)
  backoffMultiplier: 2,
  backoffMaxMs: 3e5
};
var CircuitBreaker = class {
  state = "CLOSED" /* CLOSED */;
  failures = 0;
  successes = 0;
  lastFailureTime = 0;
  halfOpenSuccesses = 0;
  consecutiveFailures = 0;
  name;
  config;
  constructor(name, config2 = {}) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG3, ...config2 };
  }
  /**
   * Compute the current cooldown.
   *
   * When backoffBaseMs is null (default), uses the fixed resetTimeoutMs for
   * backward compat. When backoffBaseMs is set, uses exponential backoff:
   *   cooldown = min(base * multiplier^(consecutiveFailures-1), max)
   */
  getCurrentCooldownMs() {
    if (this.config.backoffBaseMs === null || this.consecutiveFailures === 0) {
      return this.config.resetTimeoutMs;
    }
    const expCooldown = this.config.backoffBaseMs * Math.pow(this.config.backoffMultiplier, this.consecutiveFailures - 1);
    return Math.min(expCooldown, this.config.backoffMaxMs);
  }
  /**
   * Check if requests are allowed through.
   */
  canRequest() {
    switch (this.state) {
      case "CLOSED" /* CLOSED */:
        return true;
      case "OPEN" /* OPEN */: {
        const cooldown = this.getCurrentCooldownMs();
        if (Date.now() - this.lastFailureTime >= cooldown) {
          this.state = "HALF_OPEN" /* HALF_OPEN */;
          this.halfOpenSuccesses = 0;
          return true;
        }
        return false;
      }
      case "HALF_OPEN" /* HALF_OPEN */:
        return true;
    }
  }
  /**
   * Record a successful request.
   */
  recordSuccess() {
    this.successes++;
    switch (this.state) {
      case "HALF_OPEN" /* HALF_OPEN */:
        this.halfOpenSuccesses++;
        if (this.halfOpenSuccesses >= this.config.halfOpenSuccessThreshold) {
          this.state = "CLOSED" /* CLOSED */;
          this.failures = 0;
          this.consecutiveFailures = 0;
        }
        break;
      case "CLOSED" /* CLOSED */:
        this.failures = 0;
        this.consecutiveFailures = 0;
        break;
      case "OPEN" /* OPEN */:
        break;
    }
  }
  /**
   * Record a failed request.
   */
  recordFailure() {
    this.lastFailureTime = Date.now();
    this.failures++;
    this.consecutiveFailures++;
    switch (this.state) {
      case "HALF_OPEN" /* HALF_OPEN */:
        this.state = "OPEN" /* OPEN */;
        break;
      case "CLOSED" /* CLOSED */:
        if (this.failures >= this.config.failureThreshold) {
          this.state = "OPEN" /* OPEN */;
        }
        break;
      case "OPEN" /* OPEN */:
        break;
    }
  }
  /**
   * Get current state.
   */
  getState() {
    return this.state;
  }
  /**
   * Get provider name.
   */
  getName() {
    return this.name;
  }
  /**
   * Get config (read-only copy).
   */
  getConfig() {
    return { ...this.config };
  }
  /**
   * Update config at runtime.
   */
  updateConfig(partial) {
    this.config = { ...this.config, ...partial };
  }
  /**
   * Get stats for monitoring.
   */
  getStats() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      currentCooldownMs: this.getCurrentCooldownMs(),
      consecutiveFailures: this.consecutiveFailures
    };
  }
  /**
   * Force state change (for testing/admin).
   */
  forceState(state) {
    this.state = state;
    if (state === "CLOSED" /* CLOSED */) {
      this.failures = 0;
      this.halfOpenSuccesses = 0;
      this.consecutiveFailures = 0;
    }
  }
};
function buildBreakerKey(provider, apiKey, model) {
  const parts = [provider];
  if (apiKey) parts.push(apiKey);
  if (model) parts.push(model);
  return parts.join(":");
}
var CircuitBreakerRegistry = class {
  breakers = /* @__PURE__ */ new Map();
  enabled;
  defaultConfig = {};
  constructor(enabled = true) {
    this.enabled = enabled && process.env["LLM_GATEWAY_CIRCUIT_BREAKER_ENABLED"] !== "false";
  }
  /**
   * Get or create a circuit breaker by key.
   * Key can be a simple provider name or a composite key.
   */
  get(name) {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(name, this.defaultConfig));
    }
    return this.breakers.get(name);
  }
  /**
   * Get or create a circuit breaker with per-key:model granularity.
   */
  getForKey(provider, apiKey, model) {
    const key = buildBreakerKey(provider, apiKey, model);
    return this.get(key);
  }
  /**
   * Check if a provider can accept requests.
   */
  canRequest(providerId) {
    if (!this.enabled) return true;
    return this.get(providerId).canRequest();
  }
  /**
   * Record a successful request.
   */
  recordSuccess(providerId) {
    if (!this.enabled) return;
    this.get(providerId).recordSuccess();
  }
  /**
   * Record a failed request.
   */
  recordFailure(providerId) {
    if (!this.enabled) return;
    this.get(providerId).recordFailure();
  }
  /**
   * Get all circuit breaker stats.
   */
  getAllStats() {
    return Array.from(this.breakers.values()).map((cb) => cb.getStats());
  }
  /**
   * Get the default config applied to new breakers.
   */
  getDefaultConfig() {
    return { ...DEFAULT_CONFIG3, ...this.defaultConfig };
  }
  /**
   * Update the default config for new breakers AND all existing breakers.
   */
  updateDefaultConfig(partial) {
    this.defaultConfig = { ...this.defaultConfig, ...partial };
    for (const breaker of this.breakers.values()) {
      breaker.updateConfig(partial);
    }
  }
  /**
   * Whether the registry is enabled.
   */
  isEnabled() {
    return this.enabled;
  }
};
var registry2 = null;
function getCircuitBreakerRegistry() {
  if (!registry2) {
    registry2 = new CircuitBreakerRegistry();
  }
  return registry2;
}

// src/core/schemas.ts
import { z as z3 } from "zod";
var generateRequestSchema = z3.object({
  prompt: z3.string().min(1, "prompt is required").max(MAX_PROMPT_LENGTH, `prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`),
  model: z3.string().optional(),
  provider: z3.string().optional(),
  system: z3.string().optional(),
  maxTokens: z3.number().int().positive().optional(),
  strict: z3.boolean().optional(),
  project: z3.string().optional()
});
var chatMessageSchema = z3.object({
  role: z3.enum(["system", "user", "assistant"]),
  content: z3.string()
});
var chatCompletionsSchema = z3.object({
  model: z3.string().optional(),
  messages: z3.array(chatMessageSchema).min(1, "messages is required"),
  max_tokens: z3.number().int().positive().optional(),
  temperature: z3.number().min(0).max(2).optional(),
  stream: z3.boolean().optional()
});
var credentialStoreSchema = z3.object({
  provider: z3.string().min(1, "provider is required"),
  keyName: z3.string().optional(),
  apiKey: z3.string().min(1, "apiKey is required"),
  project: z3.string().optional()
});
var fileStoreSchema = z3.object({
  provider: z3.string().min(1, "provider is required"),
  fileName: z3.string().min(1, "fileName is required"),
  content: z3.string().min(1, "content is required"),
  project: z3.string().optional()
});
var costEstimateQuerySchema = z3.object({
  model: z3.string().min(1, "model is required"),
  inputTokens: z3.coerce.number().int().nonnegative("inputTokens must be >= 0"),
  outputTokens: z3.coerce.number().int().nonnegative("outputTokens must be >= 0")
});
function validateGenerateRequest(data) {
  return generateRequestSchema.parse(data);
}
function validateChatCompletions(data) {
  return chatCompletionsSchema.parse(data);
}
function validateCredentialStore(data) {
  return credentialStoreSchema.parse(data);
}
function validateFileStore(data) {
  return fileStoreSchema.parse(data);
}

// src/server/admin.ts
import { timingSafeEqual as timingSafeEqual2 } from "crypto";
import { z as z5 } from "zod";

// src/security/profiles.ts
import { z as z4 } from "zod";
var ToolCategorySchema = z4.enum([
  "destructive",
  "read",
  "generate",
  "admin"
]);
var RateLimitConfigSchema = z4.object({
  max: z4.number().int().positive(),
  windowMs: z4.number().int().positive()
}).nullable();
var TrustLevelSchema = z4.enum(["local-dev", "restricted", "open"]);
var SecurityProfileSchema = z4.object({
  level: TrustLevelSchema,
  allowedCategories: z4.array(ToolCategorySchema).min(1),
  rateLimit: RateLimitConfigSchema
});
var TOOL_CATEGORIES = {
  // generate
  llm_generate: "generate",
  llm_models: "generate",
  // destructive
  vault_store: "destructive",
  vault_delete: "destructive",
  vault_store_file: "destructive",
  vault_delete_file: "destructive",
  create_group: "destructive",
  delete_group: "destructive",
  // read
  vault_list: "read",
  vault_list_files: "read",
  list_groups: "read",
  circuit_breaker_stats: "read",
  usage_summary: "read",
  usage_query: "read",
  code_search: "read",
  // admin
  configure_circuit_breaker: "admin",
  index_codebase: "admin",
  shared_state: "admin"
};
var PROFILES = {
  "local-dev": SecurityProfileSchema.parse({
    level: "local-dev",
    allowedCategories: ["destructive", "read", "generate", "admin"],
    rateLimit: null
  }),
  restricted: SecurityProfileSchema.parse({
    level: "restricted",
    allowedCategories: ["read", "generate"],
    rateLimit: { max: 100, windowMs: 15 * 60 * 1e3 }
  }),
  open: SecurityProfileSchema.parse({
    level: "open",
    allowedCategories: ["generate"],
    rateLimit: { max: 10, windowMs: 15 * 60 * 1e3 }
  })
};

// src/server/admin.ts
function tokenEquals(a, b) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual2(bufA, bufB);
}
function adminAuth(config2) {
  return async (c, next) => {
    if (c.req.method === "OPTIONS") {
      return next();
    }
    const authHeader = c.req.header("Authorization");
    const parts = authHeader?.split(" ");
    const bearerToken = parts?.length === 2 && parts[0] === "Bearer" ? parts[1] : null;
    if (bearerToken) {
      const { verifyDashboardJwt } = await import("./github-oauth-B7W3VDWK.js");
      if (verifyDashboardJwt(bearerToken)) {
        return next();
      }
    }
    const adminToken = process.env["ADMIN_TOKEN"];
    const requiredToken = adminToken ?? config2.authToken;
    if (!requiredToken) {
      return next();
    }
    if (!bearerToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (!tokenEquals(bearerToken, requiredToken)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  };
}
function registerAdminRoutes(app, deps) {
  const { router: router2, config: config2, groupStore: groupStore2, costTracker: costTracker2, serverStartTime: serverStartTime2 } = deps;
  app.use("/v1/admin/*", adminAuth(config2));
  app.get("/v1/admin/me", async (c) => {
    const authHeader = c.req.header("Authorization");
    const parts = authHeader?.split(" ");
    const bearerToken = parts?.length === 2 && parts[0] === "Bearer" ? parts[1] : null;
    if (bearerToken) {
      const { verifyDashboardJwt } = await import("./github-oauth-B7W3VDWK.js");
      const payload = verifyDashboardJwt(bearerToken);
      if (payload) {
        return c.json({
          authMethod: "github",
          login: payload.login,
          name: payload.name,
          avatar: payload.avatar
        });
      }
    }
    return c.json({ authMethod: "token", login: null, name: "Admin", avatar: null });
  });
  app.get("/v1/admin/overview", async (c) => {
    try {
      const providers = await router2.getProviderStatuses();
      const groups = groupStore2 ? groupStore2.list() : [];
      const cbRegistry = getCircuitBreakerRegistry();
      const cbStats = cbRegistry.getAllStats();
      const cbSummary = {
        total: cbStats.length,
        open: cbStats.filter((s) => s.state === "OPEN" /* OPEN */).length,
        closed: cbStats.filter((s) => s.state === "CLOSED" /* CLOSED */).length,
        halfOpen: cbStats.filter((s) => s.state === "HALF_OPEN" /* HALF_OPEN */).length
      };
      let usage = { totalRequests: 0, totalCost: 0, totalTokens: 0 };
      if (costTracker2) {
        const now = /* @__PURE__ */ new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1e3);
        const summary = costTracker2.summary({
          from: oneDayAgo.toISOString(),
          to: now.toISOString()
        });
        usage = {
          totalRequests: summary.totalRequests,
          totalCost: summary.totalCostUsd,
          totalTokens: summary.totalTokensIn + summary.totalTokensOut
        };
      }
      const uptimeSeconds = Math.floor((Date.now() - serverStartTime2) / 1e3);
      return c.json({
        providers: providers.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          available: p.available
        })),
        groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          memberCount: g.members.length,
          strategy: g.strategy,
          modelPattern: g.modelPattern
        })),
        circuitBreakers: cbSummary,
        usage,
        system: {
          uptime: uptimeSeconds,
          version: VERSION,
          mode: "HTTP"
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.get("/v1/admin/providers", async (c) => {
    try {
      const providers = await router2.getProviderStatuses();
      const cbRegistry = getCircuitBreakerRegistry();
      const cbStats = cbRegistry.getAllStats();
      const cbByProvider = /* @__PURE__ */ new Map();
      for (const stat of cbStats) {
        cbByProvider.set(stat.name, {
          state: stat.state,
          failures: stat.failures,
          consecutiveFailures: stat.consecutiveFailures
        });
      }
      const detailed = providers.map((p) => {
        const cb = cbByProvider.get(p.id);
        const models = router2.getProviderModels(p.id);
        return {
          id: p.id,
          name: p.name,
          type: p.type,
          available: p.available,
          models,
          circuitBreaker: cb ?? { state: "CLOSED", failures: 0, consecutiveFailures: 0 }
        };
      });
      return c.json({ providers: detailed });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.get("/v1/admin/health", async (c) => {
    try {
      const uptimeSeconds = Math.floor((Date.now() - serverStartTime2) / 1e3);
      const providers = await router2.getProviderStatuses();
      const availableCount = providers.filter((p) => p.available).length;
      const memUsage = process.memoryUsage();
      return c.json({
        status: "ok",
        database: { connected: true },
        providers: {
          available: availableCount,
          total: providers.length
        },
        uptime: uptimeSeconds,
        version: VERSION,
        memory: {
          rss: memUsage.rss,
          heapTotal: memUsage.heapTotal,
          heapUsed: memUsage.heapUsed,
          external: memUsage.external
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({
        status: "error",
        error: message,
        database: { connected: false }
      }, 500);
    }
  });
  app.post("/v1/admin/reset-circuit-breaker/:provider", (c) => {
    try {
      const provider = c.req.param("provider");
      const cbRegistry = getCircuitBreakerRegistry();
      const stats = cbRegistry.getAllStats();
      const found = stats.find((s) => s.name === provider);
      if (!found) {
        return c.json({ error: `No circuit breaker found for: ${provider}`, code: "NOT_FOUND" }, 404);
      }
      const breaker = cbRegistry.get(provider);
      breaker.forceState("CLOSED" /* CLOSED */);
      return c.json({
        ok: true,
        provider,
        state: "CLOSED",
        message: `Circuit breaker for ${provider} has been reset`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.post("/v1/admin/flush-usage", (c) => {
    try {
      if (!costTracker2) {
        return c.json({ error: "Cost tracker not configured", code: "NOT_CONFIGURED" }, 404);
      }
      const bufferBefore = costTracker2.bufferSize;
      costTracker2.flush();
      const bufferAfter = costTracker2.bufferSize;
      return c.json({
        ok: true,
        flushed: bufferBefore - bufferAfter,
        remainingBuffer: bufferAfter
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  const CreateProfileSchema = z5.object({
    project: z5.string().min(1),
    trustLevel: TrustLevelSchema.optional().default("restricted"),
    allowedCategories: z5.array(ToolCategorySchema).min(1),
    rateLimitMax: z5.number().int().positive().nullable().optional().default(null),
    rateLimitWindowMs: z5.number().int().positive().nullable().optional().default(null)
  });
  app.post("/v1/admin/profiles", async (c) => {
    try {
      if (!deps.db) {
        return c.json({ error: "Database not configured", code: "NOT_CONFIGURED" }, 500);
      }
      const body = await c.req.json();
      const parsed = CreateProfileSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
      }
      const { project, trustLevel, allowedCategories, rateLimitMax, rateLimitWindowMs } = parsed.data;
      const stmt = deps.db.prepare(`
        INSERT INTO security_profiles (project, trust_level, allowed_categories, rate_limit_max, rate_limit_window_ms, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(project) DO UPDATE SET
          trust_level = excluded.trust_level,
          allowed_categories = excluded.allowed_categories,
          rate_limit_max = excluded.rate_limit_max,
          rate_limit_window_ms = excluded.rate_limit_window_ms,
          updated_at = datetime('now')
      `);
      stmt.run(
        project,
        trustLevel,
        JSON.stringify(allowedCategories),
        rateLimitMax,
        rateLimitWindowMs
      );
      return c.json({
        ok: true,
        project,
        trustLevel,
        allowedCategories,
        rateLimitMax,
        rateLimitWindowMs
      }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.get("/v1/admin/profiles", (c) => {
    try {
      if (!deps.db) {
        return c.json({ error: "Database not configured", code: "NOT_CONFIGURED" }, 500);
      }
      const rows = deps.db.prepare("SELECT * FROM security_profiles ORDER BY project").all();
      const profiles = rows.map((row) => ({
        id: row.id,
        project: row.project,
        trustLevel: row.trust_level,
        allowedCategories: JSON.parse(row.allowed_categories),
        rateLimitMax: row.rate_limit_max,
        rateLimitWindowMs: row.rate_limit_window_ms,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
      return c.json({ profiles });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.delete("/v1/admin/profiles/:project", (c) => {
    try {
      if (!deps.db) {
        return c.json({ error: "Database not configured", code: "NOT_CONFIGURED" }, 500);
      }
      const project = c.req.param("project");
      const result = deps.db.prepare("DELETE FROM security_profiles WHERE project = ?").run(project);
      if (result.changes === 0) {
        return c.json({ error: `No profile found for project "${project}"`, code: "NOT_FOUND" }, 404);
      }
      return c.json({ ok: true, project, message: `Profile for "${project}" deleted` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.post("/v1/admin/catalog/refresh", (c) => {
    try {
      const { freeModelRouter: freeModelRouter2 } = deps;
      if (!freeModelRouter2) {
        return c.json({ error: "Free model router not configured", code: "NOT_CONFIGURED" }, 404);
      }
      const catalog = loadCatalog();
      if (!catalog) {
        return c.json({ error: "Failed to load catalog file", code: "LOAD_FAILED" }, 500);
      }
      const entries = importCatalog(catalog, freeModelRouter2.getHealthChecker());
      const registry3 = freeModelRouter2.getRegistry();
      const imported = registry3.importModels(entries);
      return c.json({
        ok: true,
        imported,
        catalogVersion: catalog.version,
        providers: catalog.providers.length,
        message: `Catalog refreshed: ${imported} models imported from ${catalog.providers.length} providers`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  const CreateKeySchema = z5.object({
    userId: z5.string().min(1),
    project: z5.string().optional(),
    trustLevel: TrustLevelSchema.optional(),
    rateLimitMax: z5.number().int().positive().optional(),
    rateLimitWindowMs: z5.number().int().positive().optional(),
    budgetUsd: z5.number().nonnegative().optional(),
    expiresAt: z5.string().optional()
  });
  app.post("/v1/admin/keys", async (c) => {
    try {
      if (!deps.db) {
        return c.json({ error: "Database not configured", code: "NOT_CONFIGURED" }, 500);
      }
      const body = await c.req.json();
      const parsed = CreateKeySchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
      }
      const { apiKey, plaintextKey } = createApiKey(deps.db, parsed.data);
      return c.json({
        ok: true,
        key: plaintextKey,
        // Returned ONCE — never again
        id: apiKey.id,
        keyPrefix: apiKey.keyPrefix,
        userId: apiKey.userId,
        project: apiKey.project,
        trustLevel: apiKey.trustLevel,
        rateLimitMax: apiKey.rateLimitMax,
        rateLimitWindowMs: apiKey.rateLimitWindowMs,
        budgetUsd: apiKey.budgetUsd,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt
      }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.get("/v1/admin/keys", (c) => {
    try {
      if (!deps.db) {
        return c.json({ error: "Database not configured", code: "NOT_CONFIGURED" }, 500);
      }
      const userId = c.req.query("userId");
      const keys = listApiKeys(deps.db, userId ?? void 0);
      const masked = keys.map((k) => ({
        id: k.id,
        keyPrefix: k.keyPrefix,
        userId: k.userId,
        project: k.project,
        trustLevel: k.trustLevel,
        rateLimitMax: k.rateLimitMax,
        rateLimitWindowMs: k.rateLimitWindowMs,
        budgetUsd: k.budgetUsd,
        enabled: k.enabled,
        createdAt: k.createdAt,
        expiresAt: k.expiresAt
      }));
      return c.json({ keys: masked });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.delete("/v1/admin/keys/:id", (c) => {
    try {
      if (!deps.db) {
        return c.json({ error: "Database not configured", code: "NOT_CONFIGURED" }, 500);
      }
      const id = c.req.param("id");
      const revoked = revokeApiKey(deps.db, id);
      if (!revoked) {
        return c.json({ error: `No API key found with id "${id}"`, code: "NOT_FOUND" }, 404);
      }
      return c.json({ ok: true, id, message: `API key ${id} revoked` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
}

// src/server/dashboard.ts
function dashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LLM Gateway \u2014 Admin</title>
  <style>
    /* \u2500\u2500 Reset & Base \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:         #0d1117;
      --bg-card:    #161b22;
      --bg-input:   #0d1117;
      --border:     #30363d;
      --border-hl:  #484f58;
      --text:       #e6edf3;
      --text-dim:   #8b949e;
      --accent:     #a855f7;
      --accent-dim: #7c3aed;
      --green:      #3fb950;
      --red:        #f85149;
      --orange:     #d29922;
      --font-mono:  'SF Mono', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
      --font-sans:  -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      --radius:     8px;
    }

    body {
      font-family: var(--font-sans);
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
    }

    /* \u2500\u2500 Layout \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
    .container {
      max-width: 1080px;
      margin: 0 auto;
      padding: 24px 20px;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 32px;
    }

    header h1 {
      font-size: 1.5rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    header h1 .icon { font-size: 1.3rem; }

    .version {
      font-size: 0.75rem;
      color: var(--accent);
      background: rgba(168, 85, 247, 0.12);
      padding: 2px 8px;
      border-radius: 12px;
      font-family: var(--font-mono);
    }

    .health-badge {
      font-size: 0.8rem;
      padding: 4px 12px;
      border-radius: 12px;
      font-weight: 500;
    }

    .health-badge.ok { color: var(--green); background: rgba(63, 185, 80, 0.12); }
    .health-badge.err { color: var(--red); background: rgba(248, 81, 73, 0.12); }

    /* \u2500\u2500 Sections \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
    section {
      margin-bottom: 36px;
    }

    section h2 {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
      color: var(--text);
    }

    /* \u2500\u2500 Cards / Panels \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
    }

    /* \u2500\u2500 Table \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
    .table-wrap {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }

    th, td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
    }

    th {
      color: var(--text-dim);
      font-weight: 500;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    td { color: var(--text); }

    tr:last-child td { border-bottom: none; }

    td code {
      font-family: var(--font-mono);
      font-size: 0.82rem;
      background: rgba(168, 85, 247, 0.08);
      padding: 2px 6px;
      border-radius: 4px;
    }

    .empty-msg {
      color: var(--text-dim);
      text-align: center;
      padding: 24px;
      font-style: italic;
    }

    /* \u2500\u2500 Filter bar \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
    .filter-bar {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 12px;
      font-size: 0.85rem;
    }

    .filter-bar label {
      color: var(--text-dim);
      font-weight: 500;
      font-size: 0.78rem;
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: flex-end;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      padding: 0 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: rgba(168, 85, 247, 0.08);
      color: var(--text);
      font-size: 0.8rem;
      white-space: nowrap;
    }

    /* \u2500\u2500 Buttons \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
    button, .btn {
      font-family: var(--font-sans);
      font-size: 0.85rem;
      font-weight: 500;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 7px 14px;
      cursor: pointer;
      transition: all 0.15s ease;
      color: var(--text);
      background: var(--bg-card);
    }

    button:hover { border-color: var(--border-hl); background: #1c2129; }

    .btn-primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    .btn-primary:hover { background: var(--accent-dim); border-color: var(--accent-dim); }

    .btn-danger {
      color: var(--red);
      border-color: transparent;
      background: transparent;
      padding: 4px 8px;
      font-size: 0.8rem;
    }
    .btn-danger:hover { background: rgba(248, 81, 73, 0.12); }

    .btn-sm { padding: 4px 10px; font-size: 0.8rem; }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* \u2500\u2500 Forms \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
    .form-row {
      display: flex;
      gap: 10px;
      align-items: flex-end;
      flex-wrap: wrap;
      margin-top: 16px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .form-group label {
      font-size: 0.78rem;
      color: var(--text-dim);
      font-weight: 500;
    }

    input, select, textarea {
      font-family: var(--font-sans);
      font-size: 0.875rem;
      background: var(--bg-input);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 10px;
      outline: none;
      transition: border-color 0.15s ease;
    }

    input:focus, select:focus, textarea:focus {
      border-color: var(--accent);
    }

    select { min-width: 140px; }

    textarea {
      width: 100%;
      resize: vertical;
      min-height: 80px;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      line-height: 1.5;
    }

    .drop-zone {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 110px;
      padding: 18px;
      border: 1px dashed var(--border-hl);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.02);
      color: var(--text-dim);
      text-align: center;
      cursor: pointer;
      transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
    }

    .drop-zone:hover,
    .drop-zone.active {
      border-color: var(--accent);
      background: rgba(168, 85, 247, 0.08);
      color: var(--text);
    }

    .selected-file {
      min-height: 20px;
      margin-top: 8px;
      color: var(--text-dim);
      font-size: 0.82rem;
      font-family: var(--font-mono);
    }

    .help-text {
      margin: 10px 0 0;
      color: var(--text-dim);
      font-size: 0.82rem;
      line-height: 1.5;
    }

    /* \u2500\u2500 Project badge \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
    .project-badge {
      display: inline-block;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      padding: 1px 6px;
      border-radius: 4px;
      border: 1px solid var(--border);
    }

    .project-badge.global {
      color: var(--text-dim);
      background: transparent;
    }

    .project-badge.scoped {
      color: var(--accent);
      background: rgba(168, 85, 247, 0.08);
      border-color: rgba(168, 85, 247, 0.3);
    }

    /* \u2500\u2500 Provider cards \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
    .providers-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px;
    }

    .provider-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .provider-card .name {
      font-weight: 600;
      font-size: 0.95rem;
    }

    .provider-card .meta {
      font-size: 0.78rem;
      color: var(--text-dim);
      display: flex;
      gap: 12px;
    }

    .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 4px;
      vertical-align: middle;
    }

    .status-dot.on  { background: var(--green); box-shadow: 0 0 6px rgba(63, 185, 80, 0.4); }
    .status-dot.off { background: var(--red); }

    /* \u2500\u2500 Models list \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
    .models-group {
      margin-bottom: 16px;
    }

    .models-group h3 {
      font-size: 0.9rem;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--accent);
    }

    .model-chip {
      display: inline-block;
      font-family: var(--font-mono);
      font-size: 0.8rem;
      background: rgba(168, 85, 247, 0.08);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 4px 10px;
      margin: 0 6px 6px 0;
      color: var(--text);
    }

    /* \u2500\u2500 Test section \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
    .test-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .test-controls {
      display: flex;
      gap: 10px;
      align-items: flex-end;
      flex-wrap: wrap;
    }

    .response-area {
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
      min-height: 60px;
      display: none;
    }

    .response-area.visible { display: block; }

    .response-meta {
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
      font-size: 0.78rem;
      color: var(--text-dim);
      margin-top: 8px;
      display: none;
    }

    .response-meta.visible { display: grid; }

    .response-meta span {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .meta-item {
      min-height: 40px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.02);
      flex-wrap: wrap;
    }

    .route-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 64px;
      padding: 4px 8px;
      border-radius: 999px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .route-badge.direct {
      color: var(--green);
      background: rgba(63, 185, 80, 0.12);
      border: 1px solid rgba(63, 185, 80, 0.35);
    }

    .route-badge.fallback {
      color: var(--orange);
      background: rgba(210, 153, 34, 0.12);
      border: 1px solid rgba(210, 153, 34, 0.35);
    }

    .checkbox-group {
      gap: 8px;
      align-self: center;
    }

    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 38px;
    }

    .checkbox-row input {
      margin: 0;
    }

    .checkbox-row label {
      color: var(--text);
      cursor: pointer;
    }

    /* \u2500\u2500 Spinner \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid var(--border);
      border-top: 2px solid var(--accent);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    /* \u2500\u2500 Toast notification \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 12px 20px;
      border-radius: var(--radius);
      font-size: 0.85rem;
      font-weight: 500;
      color: #fff;
      z-index: 1000;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.25s ease;
      pointer-events: none;
    }

    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }

    .toast.success { background: var(--green); }
    .toast.error   { background: var(--red); }

    /* \u2500\u2500 Login screen \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
    .login-screen {
      position: fixed;
      inset: 0;
      background: var(--bg);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
    }

    .login-screen.hidden { display: none; }

    .login-box {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 32px;
      width: 380px;
      max-width: calc(100vw - 32px);
      text-align: center;
    }

    .login-box h2 {
      font-size: 1.3rem;
      margin-bottom: 8px;
      border: none;
      padding: 0;
    }

    .login-box p {
      font-size: 0.85rem;
      color: var(--text-dim);
      margin-bottom: 20px;
    }

    .login-box .form-group {
      margin-bottom: 16px;
      text-align: left;
    }

    .login-box input {
      width: 100%;
    }

    .login-box .login-error {
      font-size: 0.82rem;
      color: var(--red);
      margin-bottom: 12px;
      display: none;
    }

    .login-box .login-error.visible { display: block; }

    .btn-logout {
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 10px;
      cursor: pointer;
      font-size: 0.82rem;
      color: var(--text-dim);
      transition: all 0.15s ease;
    }

    .btn-logout:hover { border-color: var(--red); color: var(--red); background: rgba(248, 81, 73, 0.08); }

    /* \u2500\u2500 Responsive \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
    @media (max-width: 640px) {
      .container { padding: 16px 12px; }
      .form-row { flex-direction: column; }
      .form-group { width: 100%; }
      .test-controls { flex-direction: column; }
      .test-controls .form-group { width: 100%; }
      header { flex-direction: column; gap: 12px; align-items: flex-start; }
    }
  </style>
</head>
<body>
  <!-- \u2500\u2500 Login screen \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
  <div id="login-screen" class="login-screen hidden">
    <div class="login-box">
      <h2>\u{1F512} LLM Gateway</h2>
      <p>Enter the auth token to access the dashboard.</p>
      <div id="login-error" class="login-error"></div>
      <div class="form-group">
        <label for="login-token">Auth Token</label>
        <input type="password" id="login-token" placeholder="Enter token\u2026" autocomplete="off">
      </div>
      <button class="btn-primary" style="width:100%" onclick="submitLogin()">Enter</button>
    </div>
  </div>

  <div class="container">

    <!-- \u2500\u2500 External dashboard banner \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
    <div style="
      background: rgba(168, 85, 247, 0.08);
      border: 1px solid rgba(168, 85, 247, 0.25);
      border-radius: 8px;
      padding: 10px 16px;
      margin-bottom: 20px;
      font-size: 0.85rem;
      color: var(--text-dim);
    ">
      \u{1F4F1} This dashboard is also available at
      <a href="https://gateway.javierzader.com/"
         target="_blank" rel="noopener"
         style="color: var(--accent); text-decoration: none; font-weight: 500;">
        gateway.javierzader.com
      </a>
    </div>

    <!-- \u2500\u2500 Header \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
    <header>
      <h1>
        <span class="icon">\u26A1</span> LLM Gateway
        <span class="version">v0.3.1</span>
      </h1>
      <div style="display:flex;align-items:center;gap:10px">
        <span id="health" class="health-badge">checking\u2026</span>
        <button id="logout-btn" class="btn-logout" style="display:none" onclick="doLogout()">\u{1F512} Logout</button>
      </div>
    </header>

    <!-- \u2500\u2500 Credentials \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
    <section id="sec-credentials">
      <h2>\u{1F510} Credentials</h2>
      <div class="card">
        <div class="filter-bar">
          <label for="cred-filter-project">Filter by project:</label>
          <select id="cred-filter-project" onchange="loadCredentials()">
            <option value="">All</option>
            <option value="_global">_global</option>
            <option value="ghagga">ghagga</option>
            <option value="md-evals">md-evals</option>
            <option value="repoforge">repoforge</option>
          </select>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Key Name</th>
                <th>Project</th>
                <th>Value</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="cred-rows">
              <tr><td colspan="6" class="empty-msg">Loading\u2026</td></tr>
            </tbody>
          </table>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="cred-provider">Provider</label>
            <select id="cred-provider">
              <option value="anthropic">anthropic</option>
              <option value="openai">openai</option>
              <option value="groq">groq</option>
              <option value="openrouter">openrouter</option>
              <option value="google">google</option>
              <option value="github-copilot">github-copilot</option>
            </select>
          </div>
          <div class="form-group">
            <label for="cred-name">Key Name</label>
            <input type="text" id="cred-name" placeholder="default" value="default" style="width:120px">
          </div>
          <div class="form-group">
            <label for="cred-project">Project</label>
            <select id="cred-project">
              <option value="_global">_global (shared)</option>
              <option value="ghagga">ghagga</option>
              <option value="md-evals">md-evals</option>
              <option value="repoforge">repoforge</option>
              <option value="__custom__">custom\u2026</option>
            </select>
          </div>
          <div class="form-group" id="cred-custom-project-group" style="display:none">
            <label for="cred-custom-project">Custom Project</label>
            <input type="text" id="cred-custom-project" placeholder="my-project" style="width:140px">
          </div>
          <div class="form-group">
            <label for="cred-key">API Key</label>
            <input type="password" id="cred-key" placeholder="sk-\u2026" style="width:280px">
          </div>
          <button class="btn-primary" onclick="addCredential()">Add Key</button>
        </div>
      </div>
    </section>

    <!-- \u2500\u2500 Auth Files \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
    <section id="sec-files">
      <h2>\u{1F4C1} Auth Files</h2>
      <div class="card">
        <div class="toolbar">
          <div class="form-row" style="margin-top:0">
            <button type="button" onclick="refreshFiles()">Refresh</button>
            <div class="form-group">
              <label for="file-filter-project">Project Filter</label>
              <select id="file-filter-project">
                <option value="">All</option>
                <option value="_global">_global</option>
                <option value="ghagga">ghagga</option>
                <option value="md-evals">md-evals</option>
                <option value="repoforge">repoforge</option>
                <option value="__custom__">__custom__</option>
              </select>
            </div>
            <div class="form-group" id="file-filter-custom-project-group" style="display:none">
              <label for="file-filter-custom-project">Custom Project</label>
              <input type="text" id="file-filter-custom-project" placeholder="my-project" style="width:140px">
            </div>
          </div>
          <span id="file-count" class="badge">0 files</span>
        </div>
        <p class="help-text">Auth files are encrypted at rest. Recommended uploads: opencode -> auth.json, claude -> .credentials.json (or full .claude files), gemini -> settings.json + oauth_creds.json, qwen -> settings.json + oauth_creds.json, codex -> auth.json (or full .codex files). copilot -> use Credentials section (token), not Auth Files.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>File Name</th>
                <th>Project</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="file-rows">
              <tr><td colspan="5" class="empty-msg">Loading\u2026</td></tr>
            </tbody>
          </table>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="file-provider">Provider</label>
            <select id="file-provider">
              <option value="opencode">opencode</option>
              <option value="claude">claude</option>
              <option value="gemini">gemini</option>
              <option value="codex">codex</option>
              <option value="qwen">qwen</option>
            </select>
          </div>
          <div class="form-group">
            <label for="file-project">Project</label>
            <select id="file-project">
              <option value="_global">_global (shared)</option>
              <option value="ghagga">ghagga</option>
              <option value="md-evals">md-evals</option>
              <option value="repoforge">repoforge</option>
              <option value="__custom__">__custom__</option>
            </select>
          </div>
          <div class="form-group" id="file-custom-project-group" style="display:none">
            <label for="file-custom-project">Custom Project</label>
            <input type="text" id="file-custom-project" placeholder="my-project" style="width:140px">
          </div>
        </div>

        <div class="form-row" style="display:block">
          <input type="file" id="file-input" accept=".json,application/json" style="display:none">
          <div id="file-drop-zone" class="drop-zone">Drop auth file here or click to choose</div>
          <div id="file-selected-name" class="selected-file">No file selected.</div>
        </div>

        <div class="form-row" style="display:block">
          <div class="form-group">
            <label for="file-name-manual">Manual File Name</label>
              <input type="text" id="file-name-manual" placeholder="auth.json, .credentials.json, settings.json, oauth_creds.json">
          </div>
          <div class="form-group" style="margin-top:10px">
            <label for="file-content-manual">Manual File Contents</label>
            <textarea id="file-content-manual" placeholder="Paste auth file contents here (JSON)"></textarea>
          </div>
          <p class="help-text">Use manual paste when your browser file picker hides dotfiles such as <code>.credentials.json</code>.</p>
        </div>

        <div class="form-row">
          <button class="btn-primary" onclick="uploadFile()">Upload</button>
        </div>
      </div>
    </section>

    <!-- \u2500\u2500 Providers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
    <section id="sec-providers">
      <h2>\u{1F4E1} Providers</h2>
      <div id="providers-grid" class="providers-grid">
        <div class="empty-msg">Loading\u2026</div>
      </div>
    </section>

    <!-- \u2500\u2500 Models \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
    <section id="sec-models">
      <h2>\u{1F9E0} Models</h2>
      <div id="models-list" class="card">
        <div class="empty-msg">Loading\u2026</div>
      </div>
    </section>

    <!-- \u2500\u2500 Test \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
    <section id="sec-test">
      <h2>\u{1F9EA} Test Generation</h2>
      <div class="card">
        <div class="test-form">
          <div class="form-group">
            <label for="test-prompt">Prompt</label>
            <textarea id="test-prompt" placeholder="Enter a prompt to test\u2026" rows="3"></textarea>
          </div>
          <div class="test-controls">
            <div class="form-group">
              <label for="test-provider">Provider (optional)</label>
              <select id="test-provider">
                <option value="">auto</option>
              </select>
            </div>
            <div class="form-group">
              <label for="test-model">Model (optional)</label>
              <select id="test-model">
                <option value="">auto</option>
              </select>
            </div>
            <div class="form-group">
              <label for="test-project">Project (optional)</label>
              <select id="test-project">
                <option value="">none</option>
                <option value="_global">_global</option>
                <option value="ghagga">ghagga</option>
                <option value="md-evals">md-evals</option>
                <option value="repoforge">repoforge</option>
              </select>
            </div>
            <div class="form-group">
              <label for="test-tokens">Max Tokens</label>
              <input type="number" id="test-tokens" placeholder="1024" value="1024" style="width:90px">
            </div>
            <div class="form-group checkbox-group">
              <div class="checkbox-row">
                <input type="checkbox" id="test-strict">
                <label for="test-strict">Strict (no fallback)</label>
              </div>
            </div>
            <button class="btn-primary" id="test-btn" onclick="runTest()">Generate</button>
          </div>
          <p class="help-text">Strict mode is recommended for debugging provider-specific issues.</p>
          <div id="test-response" class="response-area"></div>
          <div id="test-meta" class="response-meta">
            <span id="meta-requested-provider" class="meta-item">\u2014</span>
            <span id="meta-requested-model" class="meta-item">\u2014</span>
            <span id="meta-resolved-provider" class="meta-item">\u2014</span>
            <span id="meta-resolved-model" class="meta-item">\u2014</span>
            <span id="meta-route" class="meta-item">\u2014</span>
            <span id="meta-tokens" class="meta-item">\u2014</span>
          </div>
        </div>
      </div>
    </section>

  </div>

  <!-- Toast -->
  <div id="toast" class="toast"></div>

  <script>
    // \u2500\u2500 Auth state \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

    const AUTH_STORAGE_KEY = 'llm-gateway-token';

    function getToken() {
      return localStorage.getItem(AUTH_STORAGE_KEY) || '';
    }

    function setToken(token) {
      localStorage.setItem(AUTH_STORAGE_KEY, token);
    }

    function clearToken() {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }

    function showLogin(errorMsg) {
      const screen = document.getElementById('login-screen');
      const errEl = document.getElementById('login-error');
      screen.classList.remove('hidden');
      if (errorMsg) {
        errEl.textContent = errorMsg;
        errEl.classList.add('visible');
      } else {
        errEl.classList.remove('visible');
      }
      document.getElementById('login-token').focus();
    }

    function hideLogin() {
      document.getElementById('login-screen').classList.add('hidden');
    }

    function submitLogin() {
      const token = document.getElementById('login-token').value.trim();
      if (!token) return;
      setToken(token);
      hideLogin();
      document.getElementById('login-token').value = '';
      document.getElementById('logout-btn').style.display = '';
      refreshAll().catch(function() {});
      checkHealth();
    }

    function doLogout() {
      clearToken();
      document.getElementById('logout-btn').style.display = 'none';
      showLogin();
    }

    // Submit on Enter key in login input
    document.addEventListener('DOMContentLoaded', function() {
      var loginInput = document.getElementById('login-token');
      if (loginInput) {
        loginInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') submitLogin();
        });
      }
    });

    // \u2500\u2500 API helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

    function authHeaders() {
      const token = getToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      return headers;
    }

    async function api(path, opts = {}) {
      const res = await fetch(path, {
        headers: authHeaders(),
        ...opts,
      });
      if (res.status === 401) {
        clearToken();
        document.getElementById('logout-btn').style.display = 'none';
        showLogin('Session expired or invalid token. Please log in again.');
        throw new Error('Unauthorized');
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    }

    function toast(msg, type = 'success') {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'toast ' + type + ' show';
      setTimeout(() => el.classList.remove('show'), 3000);
    }

    function escHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function fmtDate(iso) {
      if (!iso) return '\u2014';
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function projectBadge(project) {
      const isGlobal = project === '_global';
      const cls = isGlobal ? 'global' : 'scoped';
      return '<span class="project-badge ' + cls + '">' + escHtml(project) + '</span>';
    }

    // \u2500\u2500 Custom project toggle \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

    document.getElementById('cred-project').addEventListener('change', function() {
      const customGroup = document.getElementById('cred-custom-project-group');
      customGroup.style.display = this.value === '__custom__' ? 'flex' : 'none';
    });

    // \u2500\u2500 Credentials \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

    async function loadCredentials() {
      try {
        const filterProject = document.getElementById('cred-filter-project').value;
        const url = filterProject ? '/v1/credentials?project=' + encodeURIComponent(filterProject) : '/v1/credentials';
        const { credentials } = await api(url);
        const tbody = document.getElementById('cred-rows');
        if (!credentials || credentials.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">No credentials stored. Add one below.</td></tr>';
          return;
        }
        tbody.innerHTML = credentials.map(c => \`
          <tr>
            <td><code>\${escHtml(c.provider)}</code></td>
            <td><code>\${escHtml(c.keyName)}</code></td>
            <td>\${projectBadge(c.project || '_global')}</td>
            <td><code>\${escHtml(c.maskedValue)}</code></td>
            <td>\${fmtDate(c.createdAt)}</td>
            <td><button class="btn-danger btn-sm" onclick="deleteCredential(\${c.id}, '\${escHtml(c.provider)}')">\u2715 Delete</button></td>
          </tr>
        \`).join('');
      } catch (e) {
        document.getElementById('cred-rows').innerHTML =
          '<tr><td colspan="6" class="empty-msg" style="color:var(--red)">Failed to load: ' + escHtml(e.message) + '</td></tr>';
      }
    }

    async function addCredential() {
      const provider = document.getElementById('cred-provider').value;
      const keyName  = document.getElementById('cred-name').value.trim() || 'default';
      const apiKey   = document.getElementById('cred-key').value.trim();

      const projectSelect = document.getElementById('cred-project').value;
      const project = projectSelect === '__custom__'
        ? (document.getElementById('cred-custom-project').value.trim() || '_global')
        : projectSelect;

      if (!apiKey) {
        toast('API key is required', 'error');
        return;
      }

      try {
        await api('/v1/credentials', {
          method: 'POST',
          body: JSON.stringify({ provider, keyName, apiKey, project }),
        });
        document.getElementById('cred-key').value = '';
        toast('Credential added for ' + provider + ' (' + project + ')');
        await refreshAll();
      } catch (e) {
        toast('Failed: ' + e.message, 'error');
      }
    }

    async function deleteCredential(id, provider) {
      if (!confirm('Delete credential for "' + provider + '"?')) return;
      try {
        await api('/v1/credentials/' + id, { method: 'DELETE' });
        toast('Credential deleted');
        await refreshAll();
      } catch (e) {
        toast('Failed: ' + e.message, 'error');
      }
    }

    // \u2500\u2500 Auth Files \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

    let selectedAuthFile = null;
    let cachedModels = [];

    function getSelectedFileProject(selectId = 'file-project', customInputId = 'file-custom-project', fallbackValue = '_global') {
      const projectSelect = document.getElementById(selectId).value;
      if (projectSelect === '__custom__') {
        return document.getElementById(customInputId).value.trim() || fallbackValue;
      }
      return projectSelect || fallbackValue;
    }

    function setSelectedFile(file) {
      selectedAuthFile = file || null;
      document.getElementById('file-selected-name').textContent = file ? file.name : 'No file selected.';
    }

    function clearSelectedFile() {
      selectedAuthFile = null;
      document.getElementById('file-input').value = '';
      document.getElementById('file-selected-name').textContent = 'No file selected.';
    }

    function updateFileCount(count) {
      document.getElementById('file-count').textContent = count === 1 ? '1 file' : count + ' files';
    }

    function toggleFileCustomProject() {
      const customGroup = document.getElementById('file-custom-project-group');
      customGroup.style.display = document.getElementById('file-project').value === '__custom__' ? 'flex' : 'none';
    }

    function toggleFileFilterCustomProject() {
      const customGroup = document.getElementById('file-filter-custom-project-group');
      customGroup.style.display = document.getElementById('file-filter-project').value === '__custom__' ? 'flex' : 'none';
    }

    async function refreshFiles() {
      await loadFiles();
    }

    async function loadFiles() {
      const tbody = document.getElementById('file-rows');
      try {
        const project = getSelectedFileProject('file-filter-project', 'file-filter-custom-project', '');
        const url = project ? '/v1/files?project=' + encodeURIComponent(project) : '/v1/files';
        const { files } = await api(url);
        console.debug('[dashboard] loaded files:', files);
        updateFileCount(files ? files.length : 0);
        if (!files || files.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">No auth files stored yet.</td></tr>';
          return;
        }
        tbody.innerHTML = files.map(f => \`
          <tr>
            <td><code>\${escHtml(f.provider)}</code></td>
            <td><code>\${escHtml(f.fileName)}</code></td>
            <td>\${projectBadge(f.project || '_global')}</td>
            <td>\${fmtDate(f.createdAt)}</td>
            <td><button class="btn-danger btn-sm" onclick="deleteFile(\${f.id}, '\${escHtml(f.fileName)}')">\u2715 Delete</button></td>
          </tr>
        \`).join('');
      } catch (e) {
        updateFileCount(0);
        tbody.innerHTML =
          '<tr><td colspan="5" class="empty-msg" style="color:var(--red)">Failed to load: ' + escHtml(e.message) + '</td></tr>';
      }
    }

    async function uploadFile() {
      const provider = document.getElementById('file-provider').value;
      const project = getSelectedFileProject('file-project', 'file-custom-project', '_global');
      const manualName = document.getElementById('file-name-manual').value.trim();
      const manualContent = document.getElementById('file-content-manual').value.trim();

      let fileName = '';
      let content = '';

      if (manualContent) {
        if (!manualName) {
          toast('Manual file name is required when pasting contents', 'error');
          return;
        }
        fileName = manualName;
        content = manualContent;
      } else if (selectedAuthFile) {
        fileName = selectedAuthFile.name;
        content = await selectedAuthFile.text();
      } else {
        toast('Select/drop a file or paste its contents first', 'error');
        return;
      }

      try {
        await api('/v1/files', {
          method: 'POST',
          body: JSON.stringify({ provider, fileName, content, project }),
        });
        clearSelectedFile();
        document.getElementById('file-name-manual').value = '';
        document.getElementById('file-content-manual').value = '';
        toast('File uploaded for ' + provider + ' (' + project + ')');
        await refreshFiles();
      } catch (e) {
        toast('Failed: ' + e.message, 'error');
      }
    }

    async function deleteFile(id, fileName) {
      if (!confirm('Delete file "' + fileName + '"?')) return;
      try {
        await api('/v1/files/' + id, { method: 'DELETE' });
        toast('File deleted');
        await refreshFiles();
      } catch (e) {
        toast('Failed: ' + e.message, 'error');
      }
    }

    // \u2500\u2500 Providers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

    function populateTestModelDropdown() {
      const providerSel = document.getElementById('test-provider');
      const modelSel = document.getElementById('test-model');
      const current = modelSel.value;
      const selectedProvider = providerSel.value;
      const filtered = selectedProvider
        ? cachedModels.filter(m => m.provider === selectedProvider)
        : cachedModels;

      modelSel.innerHTML = '<option value="">auto</option>' +
        filtered.map(m =>
          '<option value="' + escHtml(m.id) + '">' + escHtml(m.id) + '</option>'
        ).join('');
      modelSel.value = filtered.some(m => m.id === current) ? current : '';
    }

    function syncTestStrictDefault() {
      const provider = document.getElementById('test-provider').value;
      document.getElementById('test-strict').checked = !!provider;
    }

    function formatMetaValue(value) {
      return value == null || value === '' ? 'auto' : String(value);
    }

    async function loadProviders() {
      try {
        const { providers } = await api('/v1/providers');
        const grid = document.getElementById('providers-grid');

        if (!providers || providers.length === 0) {
          grid.innerHTML = '<div class="empty-msg">No providers registered.</div>';
          return;
        }

        grid.innerHTML = providers.map(p => \`
          <div class="provider-card">
            <div class="name">
              <span class="status-dot \${p.available ? 'on' : 'off'}"></span>
              \${escHtml(p.name)}
            </div>
            <div class="meta">
              <span>\${p.type.toUpperCase()}</span>
              <span>\${p.available ? 'Available' : 'Unavailable'}</span>
            </div>
          </div>
        \`).join('');

        // Populate test provider dropdown
        const sel = document.getElementById('test-provider');
        const current = sel.value;
        sel.innerHTML = '<option value="">auto</option>' +
          providers.filter(p => p.available).map(p =>
            '<option value="' + escHtml(p.id) + '">' + escHtml(p.id) + '</option>'
          ).join('');
        sel.value = current;
        populateTestModelDropdown();
        syncTestStrictDefault();
      } catch (e) {
        document.getElementById('providers-grid').innerHTML =
          '<div class="empty-msg" style="color:var(--red)">Failed to load providers</div>';
      }
    }

    // \u2500\u2500 Models \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

    async function loadModels() {
      try {
        const result = await api('/v1/models');
        const models = result.models ?? result.data ?? [];
        cachedModels = models;
        const wrap = document.getElementById('models-list');

        if (!models || models.length === 0) {
          wrap.innerHTML = '<div class="empty-msg">No models available. Add provider credentials first.</div>';
          return;
        }

        // Group by provider
        const grouped = {};
        models.forEach(m => {
          if (!grouped[m.provider]) grouped[m.provider] = [];
          grouped[m.provider].push(m);
        });

        wrap.innerHTML = Object.entries(grouped).map(([provider, items]) => \`
          <div class="models-group">
            <h3>\${escHtml(provider)}</h3>
            <div>\${items.map(m =>
              '<span class="model-chip" title="Max tokens: ' + m.maxTokens + '">' + escHtml(m.id) + '</span>'
            ).join('')}</div>
          </div>
        \`).join('');

        // Populate test model dropdown
        populateTestModelDropdown();
      } catch (e) {
        document.getElementById('models-list').innerHTML =
          '<div class="empty-msg" style="color:var(--red)">Failed to load models</div>';
      }
    }

    // \u2500\u2500 Test Generation \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

    async function runTest() {
      const prompt = document.getElementById('test-prompt').value.trim();
      if (!prompt) {
        toast('Enter a prompt first', 'error');
        return;
      }

      const provider  = document.getElementById('test-provider').value || undefined;
      const model     = document.getElementById('test-model').value || undefined;
      const project   = document.getElementById('test-project').value || undefined;
      const strict    = provider ? document.getElementById('test-strict').checked : false;
      const maxTokens = parseInt(document.getElementById('test-tokens').value, 10) || undefined;

      const btn = document.getElementById('test-btn');
      const respEl = document.getElementById('test-response');
      const metaEl = document.getElementById('test-meta');

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Generating\u2026';
      respEl.className = 'response-area visible';
      respEl.textContent = 'Waiting for response\u2026';
      metaEl.className = 'response-meta';

      try {
        const body = { prompt };
        if (provider)  body.provider  = provider;
        if (model)     body.model     = model;
        if (project)   body.project   = project;
        if (provider)  body.strict    = strict;
        if (maxTokens) body.maxTokens = maxTokens;

        const result = await api('/v1/generate', {
          method: 'POST',
          body: JSON.stringify(body),
        });

        respEl.style.color = '';
        respEl.textContent = result.text;

        const fallbackUsed = result.fallbackUsed === true;
        document.getElementById('meta-requested-provider').textContent = 'Requested provider: ' + formatMetaValue(result.requestedProvider);
        document.getElementById('meta-requested-model').textContent = 'Requested model: ' + formatMetaValue(result.requestedModel);
        document.getElementById('meta-resolved-provider').textContent = 'Resolved provider: ' + formatMetaValue(result.resolvedProvider || result.provider);
        document.getElementById('meta-resolved-model').textContent = 'Resolved model: ' + formatMetaValue(result.resolvedModel || result.model);
        document.getElementById('meta-route').innerHTML = 'Fallback used: <span class="route-badge ' + (fallbackUsed ? 'fallback">yes' : 'direct">direct') + '</span>';
        document.getElementById('meta-tokens').textContent = 'Tokens used: ' + (result.tokensUsed != null ? String(result.tokensUsed) : '\u2014');
        metaEl.className = 'response-meta visible';
      } catch (e) {
        respEl.textContent = 'Error: ' + e.message;
        respEl.style.color = 'var(--red)';
        setTimeout(() => respEl.style.color = '', 5000);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Generate';
      }
    }

    // \u2500\u2500 Health \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

    async function checkHealth() {
      try {
        const data = await api('/health');
        const el = document.getElementById('health');
        el.textContent = '\u2713 Healthy';
        el.className = 'health-badge ok';
      } catch {
        const el = document.getElementById('health');
        el.textContent = '\u2717 Unreachable';
        el.className = 'health-badge err';
      }
    }

    // \u2500\u2500 Refresh all \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

    async function refreshAll() {
      await Promise.all([
        loadCredentials(),
        loadFiles(),
        loadProviders(),
        loadModels(),
      ]);
    }

    // \u2500\u2500 Init \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

    async function init() {
      // Try a health check first \u2014 if it works, auth might be disabled
      try {
        await checkHealth();
      } catch {}

      // Try loading data \u2014 if 401, the api() helper will show login
      try {
        await refreshAll();
        // If we got here with a stored token, show logout button
        if (getToken()) {
          document.getElementById('logout-btn').style.display = '';
        }
      } catch (e) {
        // If auth failed, login screen is already shown by api()
        // If other error, just ignore \u2014 sections show their own errors
      }
    }

    document.getElementById('file-project').addEventListener('change', toggleFileCustomProject);
    document.getElementById('test-provider').addEventListener('change', function() {
      populateTestModelDropdown();
      syncTestStrictDefault();
    });
    document.getElementById('file-filter-project').addEventListener('change', function() {
      toggleFileFilterCustomProject();
      refreshFiles().catch(function() {});
    });
    document.getElementById('file-filter-custom-project').addEventListener('input', function() {
      if (document.getElementById('file-filter-project').value === '__custom__') {
        refreshFiles().catch(function() {});
      }
    });

    const fileDropZone = document.getElementById('file-drop-zone');
    const fileInput = document.getElementById('file-input');

    fileDropZone.addEventListener('click', function() {
      fileInput.click();
    });

    fileInput.addEventListener('change', function() {
      setSelectedFile(fileInput.files[0] || null);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      fileDropZone.addEventListener(eventName, function(event) {
        event.preventDefault();
        fileDropZone.classList.add('active');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      fileDropZone.addEventListener(eventName, function(event) {
        event.preventDefault();
        fileDropZone.classList.remove('active');
      });
    });

    fileDropZone.addEventListener('drop', function(event) {
      const droppedFile = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
      setSelectedFile(droppedFile || null);
    });

    toggleFileCustomProject();
    toggleFileFilterCustomProject();
    syncTestStrictDefault();

    init();
  </script>
</body>
</html>`;
}

// src/server/rate-limit.ts
var RateLimiter = class {
  entries = /* @__PURE__ */ new Map();
  config;
  cleanupInterval;
  constructor(config2 = { max: 100, windowMs: 15 * 60 * 1e3 }) {
    this.config = {
      max: config2.max ?? 100,
      windowMs: config2.windowMs ?? 15 * 60 * 1e3
    };
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1e3);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }
  /**
   * Stop the cleanup interval and release resources.
   */
  destroy() {
    clearInterval(this.cleanupInterval);
    this.entries.clear();
  }
  /**
   * Check if a request from the given key should be rate limited.
   *
   * @param key - Identifier (e.g., IP address, or combined IP+token)
   * @returns true if the request should be blocked, false if allowed
   */
  isRateLimited(key) {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt < now) {
      this.entries.set(key, {
        count: 1,
        resetAt: now + this.config.windowMs
      });
      return false;
    }
    if (entry.count >= this.config.max) {
      return true;
    }
    entry.count++;
    return false;
  }
  /**
   * Get remaining requests for a key.
   */
  getRemaining(key) {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt < now) {
      return this.config.max;
    }
    return Math.max(0, this.config.max - entry.count);
  }
  /**
   * Get reset time for a key (Unix timestamp in ms).
   */
  getResetAt(key) {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt < now) {
      return now + this.config.windowMs;
    }
    return entry.resetAt;
  }
  /**
   * Clean up expired entries.
   */
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.resetAt < now) {
        this.entries.delete(key);
      }
    }
  }
};

// src/server/http.ts
var REQUEST_TIMEOUT_MS = 12e4;
var CORRELATION_ID_HEADER = "X-Correlation-ID";
function tokenEquals2(a, b) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual3(bufA, bufB);
}
function bearerAuth(config2) {
  return async (c, next) => {
    if (!config2.authToken) {
      return next();
    }
    if (c.req.method === "GET" && c.req.path === "/health") {
      return next();
    }
    if (c.req.path.startsWith("/auth/github")) {
      return next();
    }
    if (c.req.path === "/v1/admin/auth-config") {
      return next();
    }
    if (c.req.path.startsWith("/v1/admin/")) {
      return next();
    }
    if (c.req.method === "OPTIONS") {
      return next();
    }
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (!tokenEquals2(parts[1], config2.authToken)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  };
}
function resolveProject(bodyProject, headerProject) {
  return bodyProject ?? headerProject ?? void 0;
}
function buildGatewayMetadata(result) {
  return {
    requestedProvider: result.requestedProvider,
    requestedModel: result.requestedModel,
    resolvedProvider: result.resolvedProvider,
    resolvedModel: result.resolvedModel,
    fallbackUsed: result.fallbackUsed,
    tokensUsed: result.tokensUsed
  };
}
function getCorsOrigins() {
  const envOrigins = process.env["LLM_GATEWAY_CORS_ORIGINS"];
  if (!envOrigins) {
    return ["https://gateway.javierzader.com"];
  }
  if (envOrigins === "*") {
    return "*";
  }
  return envOrigins.split(",").map((o) => o.trim());
}
async function bodySizeLimit(c, next) {
  const contentLength = c.req.header("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return c.json(
      { error: "Payload too large", code: "PAYLOAD_TOO_LARGE" },
      413
    );
  }
  await next();
}
function getClientIp(c) {
  const trustedProxies = process.env["TRUSTED_PROXY_IPS"];
  if (!trustedProxies) {
    return c.req.header("x-real-ip") ?? "unknown";
  }
  const trustedSet = new Set(trustedProxies.split(",").map((ip) => ip.trim()));
  const directIp = c.req.header("x-real-ip") ?? "unknown";
  if (trustedSet.has(directIp)) {
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) {
      const firstIp = forwarded.split(",")[0];
      return firstIp?.trim() ?? directIp;
    }
  }
  return directIp;
}
async function requestTimeout(c, next) {
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
  }, REQUEST_TIMEOUT_MS);
  try {
    await next();
  } finally {
    clearTimeout(timeoutId);
  }
  if (timedOut) {
    return c.json({ error: "Request timeout", code: "REQUEST_TIMEOUT" }, 408);
  }
}
async function correlationId(c, next) {
  const existingId = c.req.header(CORRELATION_ID_HEADER);
  const correlationId2 = existingId ?? randomUUID3();
  c.set("correlationId", correlationId2);
  c.header(CORRELATION_ID_HEADER, correlationId2);
  await next();
}
function rateLimitMiddleware(limiter) {
  return async (c, next) => {
    if (c.req.method === "GET" && c.req.path === "/health") {
      return next();
    }
    const ip = getClientIp(c);
    if (limiter.isRateLimited(ip)) {
      const resetAt = limiter.getResetAt(ip);
      const retryAfter = Math.ceil((resetAt - Date.now()) / 1e3);
      c.header("Retry-After", String(retryAfter));
      c.header("X-RateLimit-Remaining", "0");
      c.header("X-RateLimit-Reset", String(Math.floor(resetAt / 1e3)));
      c.status(429);
      c.json({
        error: "Too many requests",
        code: "RATE_LIMITED",
        retryAfter
      });
      return;
    }
    c.header("X-RateLimit-Remaining", String(limiter.getRemaining(ip)));
    c.header(
      "X-RateLimit-Reset",
      String(Math.floor(limiter.getResetAt(ip) / 1e3))
    );
    await next();
  };
}
var serverStartTime = Date.now();
function detectAnthropicSubscription(vault2) {
  try {
    const apiKey = vault2.getDecrypted("anthropic", "default");
    if (apiKey.startsWith("sk-ant-")) {
      return "api";
    }
    return "api";
  } catch {
    return "none";
  }
}
var PROVIDER_BASE_URLS = {
  google: "https://generativelanguage.googleapis.com/v1beta/openai/",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1"
};
function handleStreamingRequest(c, validated, router2, costTracker2, vault2) {
  const chatId = `chatcmpl-${randomUUID3()}`;
  const model = validated.model ?? "";
  const project = c.req.header("X-Project") ?? void 0;
  const internalMessages = validated.messages.map((m) => ({
    role: m.role,
    content: m.content
  }));
  const internalRequest = {
    messages: internalMessages,
    model: validated.model,
    maxTokens: validated.max_tokens
  };
  return streamSSE(c, async (stream) => {
    const resolved = await router2.resolveStreamingProvider(internalRequest);
    if (!resolved) {
      const result = await router2.generate({
        prompt: validated.messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n"),
        system: validated.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n") || void 0,
        model: validated.model,
        maxTokens: validated.max_tokens,
        project
      });
      await stream.writeSSE({
        data: JSON.stringify({
          id: chatId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1e3),
          model: result.model,
          choices: [
            {
              index: 0,
              delta: { content: result.text },
              finish_reason: "stop"
            }
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: result.tokensUsed ?? 0
          }
        })
      });
      await stream.writeSSE({ data: "[DONE]" });
      return;
    }
    const { provider, streamTransformer } = resolved;
    const streamRecorder = costTracker2?.recordStream(
      provider.id,
      model || "unknown",
      project
    );
    try {
      const providerCall = buildProviderStreamCall(provider.id, vault2, project);
      const chunks = streamTransformer.transformStream(
        internalRequest,
        providerCall
      );
      for await (const chunk of chunks) {
        streamRecorder?.addChunk(
          { tokensIn: chunk.tokensIn, tokensOut: chunk.tokensOut },
          chunk.content.length
        );
        await stream.writeSSE({
          data: JSON.stringify({
            id: chatId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1e3),
            model: chunk.model || model,
            choices: [
              {
                index: 0,
                delta: chunk.content ? { content: chunk.content } : {},
                finish_reason: chunk.done ? chunk.finishReason ?? "stop" : null
              }
            ],
            ...chunk.done && (chunk.tokensIn !== void 0 || chunk.tokensOut !== void 0) ? {
              usage: {
                prompt_tokens: chunk.tokensIn ?? 0,
                completion_tokens: chunk.tokensOut ?? 0,
                total_tokens: (chunk.tokensIn ?? 0) + (chunk.tokensOut ?? 0)
              }
            } : {}
          })
        });
      }
      await stream.writeSSE({ data: "[DONE]" });
      getCircuitBreakerRegistry().recordSuccess(provider.id);
      streamRecorder?.finish();
    } catch (error) {
      getCircuitBreakerRegistry().recordFailure(provider.id);
      const message = error instanceof Error ? error.message : String(error);
      streamRecorder?.finish(message);
      try {
        await stream.writeSSE({
          data: JSON.stringify({
            error: { message, type: "server_error", code: null }
          })
        });
        await stream.writeSSE({ data: "[DONE]" });
      } catch {
      }
    }
  });
}
function buildProviderStreamCall(providerId, vault2, project) {
  return async function* streamCall(request) {
    const body = request;
    if (providerId === "anthropic") {
      const Anthropic2 = (await import("@anthropic-ai/sdk")).default;
      let client;
      if (vault2) {
        const oauthToken = await vault2.getClaudeOAuthToken(project);
        if (oauthToken?.accessToken) {
          client = new Anthropic2({ authToken: oauthToken.accessToken });
        } else {
          const apiKey = vault2.getDecrypted("anthropic", "default", project);
          client = new Anthropic2({ apiKey });
        }
      } else {
        client = new Anthropic2();
      }
      const { stream: _stream, ...restBody } = body;
      const messageStream = client.messages.stream(
        restBody
      );
      for await (const event of messageStream) {
        yield event;
      }
    } else {
      const OpenAI3 = (await import("openai")).default;
      let apiKey = "";
      if (vault2) {
        try {
          apiKey = vault2.getDecrypted(providerId, "default", project);
        } catch {
        }
      }
      const baseURL = PROVIDER_BASE_URLS[providerId];
      const client = new OpenAI3({
        apiKey,
        ...baseURL ? { baseURL } : {}
      });
      const { stream: _stream, stream_options: _so, ...restBody } = body;
      const streamResponse = await client.chat.completions.create({
        ...restBody,
        stream: true,
        stream_options: { include_usage: true }
      });
      for await (const chunk of streamResponse) {
        yield chunk;
      }
    }
  };
}
function startHttpServer(router2, vault2, config2, groupStore2, costTracker2, latencyMeasurer2, freeModelRouter2, db2, comparisonService2, ..._rest) {
  serverStartTime = Date.now();
  const app = new Hono();
  const rateLimiter = new RateLimiter();
  app.use(compress());
  app.use(requestTimeout);
  app.use(correlationId);
  app.use("*", rateLimitMiddleware(rateLimiter));
  app.use("*", bodySizeLimit);
  const corsOrigins = getCorsOrigins();
  app.use(
    "*",
    cors({
      origin: corsOrigins === "*" ? "*" : corsOrigins,
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Project"],
      exposeHeaders: ["Content-Length"],
      maxAge: 86400
    })
  );
  const multiTenantEnabled = process.env["ENABLE_MULTI_TENANT"] === "true" && db2;
  if (multiTenantEnabled) {
    app.use("/v1/*", async (c, next) => {
      if (c.req.path.startsWith("/v1/admin/")) {
        return next();
      }
      return apiKeyAuth(db2, costTracker2)(c, next);
    });
    app.use("*", async (c, next) => {
      if (c.req.path.startsWith("/v1/")) {
        return next();
      }
      return bearerAuth(config2)(c, next);
    });
  } else {
    app.use("*", bearerAuth(config2));
  }
  app.get("/auth/github", (c) => {
    if (!isGithubOauthConfigured()) {
      return c.json({ error: "GitHub OAuth not configured" }, 503);
    }
    const state = randomBytes3(16).toString("hex");
    const origin = new URL(c.req.url).origin;
    const redirectUri = `${origin}/auth/github/callback`;
    c.header("Set-Cookie", `gh_oauth_state=${state}; HttpOnly; Path=/; Max-Age=300; SameSite=Lax`);
    return c.redirect(getGithubAuthUrl(state, redirectUri), 302);
  });
  app.get("/auth/github/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const cookieHeader = c.req.header("Cookie") ?? "";
    const storedState = cookieHeader.split(";").map((p) => p.trim()).find((p) => p.startsWith("gh_oauth_state="))?.split("=")[1];
    c.header("Set-Cookie", "gh_oauth_state=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
    if (!code || !state || state !== storedState) {
      return c.redirect(
        "/#/oauth/callback?error=" + encodeURIComponent("Invalid OAuth state. Please try again.")
      );
    }
    try {
      const user = await exchangeCodeForUser(code);
      if (!isUserAllowed(user.login)) {
        return c.redirect(
          "/#/oauth/callback?error=" + encodeURIComponent(`User "${user.login}" is not allowed. Contact the admin.`)
        );
      }
      const token = createDashboardJwt(user);
      return c.redirect(`/#/oauth/callback?token=${token}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "GitHub OAuth failed";
      return c.redirect("/#/oauth/callback?error=" + encodeURIComponent(msg));
    }
  });
  app.get("/v1/admin/auth-config", (c) => {
    return c.json({ githubOauth: isGithubOauthConfigured() });
  });
  const dashboardHtmlCache = dashboardHtml();
  app.get("/", (c) => c.html(dashboardHtmlCache));
  app.get("/health", async (c) => {
    const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1e3);
    const providers = await router2.getProviderStatuses();
    const availableCount = providers.filter((p) => p.available).length;
    const authMode = config2.authToken ? "bearer" : "disabled";
    const subscription = detectAnthropicSubscription(vault2);
    return c.json({
      status: "ok",
      version: VERSION,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      uptime: uptimeSeconds,
      auth: {
        enabled: !!config2.authToken,
        mode: authMode
      },
      providers: {
        total: providers.length,
        available: availableCount
      },
      subscription: {
        anthropic: subscription
      },
      mode: "proxy"
    });
  });
  app.get("/metrics", async (c) => {
    await updateProviderAvailability(router2);
    const metrics = await getMetrics();
    return c.text(metrics, 200, { "Content-Type": getMetricsContentType() });
  });
  app.post("/v1/generate", async (c) => {
    try {
      const body = await c.req.json();
      let validated;
      try {
        validated = validateGenerateRequest(body);
      } catch (error) {
        if (error && typeof error === "object" && "issues" in error) {
          const issues = error.issues;
          const firstIssue = issues[0];
          return c.json(
            {
              error: firstIssue?.message ?? "Validation error",
              code: "VALIDATION_ERROR",
              field: firstIssue?.path?.join(".") ?? ""
            },
            400
          );
        }
        throw error;
      }
      const headerProject = c.req.header("X-Project") ?? void 0;
      const project = resolveProject(validated.project, headerProject);
      const result = await router2.generate({
        prompt: validated.prompt,
        model: validated.model,
        provider: validated.provider,
        system: validated.system,
        maxTokens: validated.maxTokens,
        strict: validated.strict,
        project
      });
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.post("/v1/chat/completions", async (c) => {
    try {
      const body = await c.req.json();
      let validated;
      try {
        validated = validateChatCompletions(body);
      } catch (error) {
        if (error && typeof error === "object" && "issues" in error) {
          const issues = error.issues;
          const firstIssue = issues[0];
          return c.json(
            {
              error: {
                message: firstIssue?.message ?? "Validation error",
                type: "invalid_request_error",
                param: firstIssue?.path?.join(".") || void 0,
                code: null
              }
            },
            400
          );
        }
        throw error;
      }
      if (validated.stream) {
        return handleStreamingRequest(c, validated, router2, costTracker2, vault2);
      }
      const systemMessages = validated.messages.filter((m) => m.role === "system").map((m) => m.content);
      const system = systemMessages.length > 0 ? systemMessages.join("\n") : void 0;
      const conversationMessages = validated.messages.filter(
        (m) => m.role !== "system"
      );
      const lastUserMessage = [...conversationMessages].reverse().find((m) => m.role === "user");
      if (!lastUserMessage) {
        return c.json(
          {
            error: {
              message: "At least one user message is required",
              type: "invalid_request_error",
              param: "messages",
              code: null
            }
          },
          400
        );
      }
      const earlierMessages = conversationMessages.slice(0, -1);
      let prompt = lastUserMessage.content;
      if (earlierMessages.length > 0) {
        const context2 = earlierMessages.map((m) => `${m.role}: ${m.content}`).join("\n");
        prompt = `${context2}
user: ${lastUserMessage.content}`;
      }
      const headerProject = c.req.header("X-Project") ?? void 0;
      const result = await router2.generate({
        prompt,
        system,
        model: validated.model,
        maxTokens: validated.max_tokens,
        project: headerProject
      });
      return c.json({
        id: `chatcmpl-${randomUUID3()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1e3),
        model: result.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: result.text
            },
            finish_reason: "stop"
          }
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: result.tokensUsed ?? 0
        },
        x_gateway: buildGatewayMetadata(result)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json(
        {
          error: {
            message,
            type: "server_error",
            param: null,
            code: null
          }
        },
        500
      );
    }
  });
  app.get("/v1/models", async (c) => {
    try {
      const models = await router2.getAvailableModels();
      return c.json({
        object: "list",
        data: models.map((m) => ({
          id: m.id,
          object: "model",
          created: 0,
          owned_by: "llm-gateway",
          // Gateway-specific fields
          name: m.name,
          provider: m.provider,
          max_tokens: m.maxTokens
        }))
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json(
        {
          error: {
            message,
            type: "server_error",
            param: null,
            code: null
          }
        },
        500
      );
    }
  });
  app.get("/v1/providers", async (c) => {
    try {
      const providers = await router2.getProviderStatuses();
      return c.json({ providers });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.get("/v1/latency", (c) => {
    try {
      if (!latencyMeasurer2) {
        return c.json(
          {
            error: "Latency measurement not enabled",
            code: "NOT_ENABLED"
          },
          503
        );
      }
      const measurements = latencyMeasurer2.getAll();
      const TWO_HOURS_MS = 2 * 60 * 60 * 1e3;
      const now = Date.now();
      return c.json({
        providers: measurements.map((m) => ({
          provider: m.provider,
          latencyMs: m.latencyMs,
          measuredAt: m.measuredAt,
          stale: now - m.measuredAt > TWO_HOURS_MS
        })),
        count: measurements.length,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.get("/v1/cost/estimate", (c) => {
    try {
      const query = {
        model: c.req.query("model"),
        inputTokens: c.req.query("inputTokens"),
        outputTokens: c.req.query("outputTokens")
      };
      const parsed = costEstimateQuerySchema.safeParse(query);
      if (!parsed.success) {
        const issues = parsed.error.issues;
        const firstIssue = issues[0];
        return c.json(
          {
            error: "Validation error",
            details: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid query parameters"
          },
          400
        );
      }
      const result = estimateCost(
        parsed.data.model,
        parsed.data.inputTokens,
        parsed.data.outputTokens
      );
      if (!result) {
        return c.json({ error: "Unknown model" }, 400);
      }
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.get("/v1/cost/models", (c) => {
    try {
      const table = getPriceTable();
      return c.json(table);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.post("/v1/credentials", async (c) => {
    try {
      const body = await c.req.json();
      let validated;
      try {
        validated = validateCredentialStore(body);
      } catch (error) {
        if (error && typeof error === "object" && "issues" in error) {
          const issues = error.issues;
          const firstIssue = issues[0];
          return c.json(
            {
              error: firstIssue?.message ?? "Validation error",
              code: "VALIDATION_ERROR",
              field: firstIssue?.path?.join(".") ?? "",
              validProviders: [...VALID_PROVIDERS]
            },
            400
          );
        }
        throw error;
      }
      const keyName = validated.keyName ?? "default";
      const headerProject = c.req.header("X-Project") ?? void 0;
      const project = resolveProject(validated.project, headerProject);
      const id = vault2.store(
        validated.provider,
        keyName,
        validated.apiKey,
        project
      );
      return c.json(
        {
          id,
          provider: validated.provider,
          keyName,
          project: project ?? "_global"
        },
        201
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.get("/v1/credentials", (c) => {
    try {
      const project = c.req.query("project") ?? c.req.header("X-Project") ?? void 0;
      const credentials = vault2.listMasked(project);
      return c.json({ credentials });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.delete("/v1/credentials/:id", (c) => {
    try {
      const id = Number(c.req.param("id"));
      if (isNaN(id)) {
        return c.json({ error: "id must be a number" }, 400);
      }
      const project = c.req.query("project") ?? c.req.header("X-Project") ?? void 0;
      vault2.delete(id, project);
      return c.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Unauthorized")) {
        return c.json({ error: message, code: "UNAUTHORIZED" }, 403);
      }
      if (message.includes("not found")) {
        return c.json({ error: message, code: "NOT_FOUND" }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });
  app.post("/v1/files", async (c) => {
    try {
      const body = await c.req.json();
      let validated;
      try {
        validated = validateFileStore(body);
      } catch (error) {
        if (error && typeof error === "object" && "issues" in error) {
          const issues = error.issues;
          const firstIssue = issues[0];
          return c.json(
            {
              error: firstIssue?.message ?? "Validation error",
              code: "VALIDATION_ERROR",
              field: firstIssue?.path?.join(".") ?? ""
            },
            400
          );
        }
        throw error;
      }
      const headerProject = c.req.header("X-Project") ?? void 0;
      const project = resolveProject(validated.project, headerProject);
      const id = vault2.storeFile(
        validated.provider,
        validated.fileName,
        validated.content,
        project
      );
      return c.json(
        {
          id,
          provider: validated.provider,
          fileName: validated.fileName,
          project: project ?? "_global"
        },
        201
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.get("/v1/files", (c) => {
    try {
      const project = c.req.query("project") ?? c.req.header("X-Project") ?? void 0;
      const files = vault2.listFiles(project);
      return c.json({ files });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.delete("/v1/files/:id", (c) => {
    try {
      const id = Number(c.req.param("id"));
      if (isNaN(id)) {
        return c.json({ error: "id must be a number" }, 400);
      }
      const project = c.req.query("project") ?? c.req.header("X-Project") ?? void 0;
      vault2.deleteFile(id, project);
      return c.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Unauthorized")) {
        return c.json({ error: message, code: "UNAUTHORIZED" }, 403);
      }
      if (message.includes("not found")) {
        return c.json({ error: message, code: "NOT_FOUND" }, 404);
      }
      return c.json({ error: message }, 500);
    }
  });
  if (groupStore2) {
    app.get("/v1/groups", (c) => {
      try {
        const groups = groupStore2.list();
        return c.json({ groups });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 500);
      }
    });
    app.post("/v1/groups", async (c) => {
      try {
        const body = await c.req.json();
        let validated;
        try {
          validated = CreateGroupSchema.parse(body);
        } catch (error) {
          if (error && typeof error === "object" && "issues" in error) {
            const issues = error.issues;
            const firstIssue = issues[0];
            return c.json(
              {
                error: firstIssue?.message ?? "Validation error",
                code: "VALIDATION_ERROR",
                field: firstIssue?.path?.join(".") ?? ""
              },
              400
            );
          }
          throw error;
        }
        const group = groupStore2.create(validated);
        return c.json(group, 201);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 500);
      }
    });
    app.put("/v1/groups/:id", async (c) => {
      try {
        const id = c.req.param("id");
        const body = await c.req.json();
        let validated;
        try {
          validated = UpdateGroupSchema.parse(body);
        } catch (error) {
          if (error && typeof error === "object" && "issues" in error) {
            const issues = error.issues;
            const firstIssue = issues[0];
            return c.json(
              {
                error: firstIssue?.message ?? "Validation error",
                code: "VALIDATION_ERROR",
                field: firstIssue?.path?.join(".") ?? ""
              },
              400
            );
          }
          throw error;
        }
        const updated = groupStore2.update(id, validated);
        if (!updated) {
          return c.json(
            { error: `Group not found: ${id}`, code: "NOT_FOUND" },
            404
          );
        }
        return c.json(updated);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 500);
      }
    });
    app.delete("/v1/groups/:id", (c) => {
      try {
        const id = c.req.param("id");
        const deleted = groupStore2.delete(id);
        if (!deleted) {
          return c.json(
            { error: `Group not found: ${id}`, code: "NOT_FOUND" },
            404
          );
        }
        return c.json({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 500);
      }
    });
  }
  if (costTracker2) {
    app.get("/v1/usage", (c) => {
      try {
        const provider = c.req.query("provider") ?? void 0;
        const model = c.req.query("model") ?? void 0;
        const project = c.req.query("project") ?? c.req.header("X-Project") ?? void 0;
        const from = c.req.query("from") ?? void 0;
        const to = c.req.query("to") ?? void 0;
        const groupBy = c.req.query("groupBy");
        const limitStr = c.req.query("limit");
        const limit = limitStr ? parseInt(limitStr, 10) : void 0;
        const records = costTracker2.query({
          provider,
          model,
          project,
          from,
          to,
          groupBy,
          limit
        });
        return c.json({ records, count: records.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 500);
      }
    });
    app.get("/v1/usage/summary", (c) => {
      try {
        const provider = c.req.query("provider") ?? void 0;
        const model = c.req.query("model") ?? void 0;
        const project = c.req.query("project") ?? c.req.header("X-Project") ?? void 0;
        const from = c.req.query("from") ?? void 0;
        const to = c.req.query("to") ?? void 0;
        const groupBy = c.req.query("groupBy");
        const summary = costTracker2.summary({
          provider,
          model,
          project,
          from,
          to,
          groupBy
        });
        return c.json(summary);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 500);
      }
    });
  }
  app.get("/v1/circuit-breaker/config", (c) => {
    try {
      const cbRegistry = getCircuitBreakerRegistry();
      const config3 = cbRegistry.getDefaultConfig();
      return c.json({
        enabled: cbRegistry.isEnabled(),
        failureThreshold: config3.failureThreshold,
        backoffBaseMs: config3.backoffBaseMs,
        backoffMultiplier: config3.backoffMultiplier,
        backoffMaxMs: config3.backoffMaxMs,
        resetTimeoutMs: config3.resetTimeoutMs,
        halfOpenSuccessThreshold: config3.halfOpenSuccessThreshold
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.put("/v1/circuit-breaker/config", async (c) => {
    try {
      const body = await c.req.json();
      const cbRegistry = getCircuitBreakerRegistry();
      const update = {};
      if (typeof body.failureThreshold === "number" && body.failureThreshold > 0) {
        update["failureThreshold"] = body.failureThreshold;
      }
      if (typeof body.backoffBaseMs === "number" && body.backoffBaseMs > 0) {
        update["backoffBaseMs"] = body.backoffBaseMs;
      }
      if (typeof body.backoffMultiplier === "number" && body.backoffMultiplier > 0) {
        update["backoffMultiplier"] = body.backoffMultiplier;
      }
      if (typeof body.backoffMaxMs === "number" && body.backoffMaxMs > 0) {
        update["backoffMaxMs"] = body.backoffMaxMs;
      }
      if (typeof body.resetTimeoutMs === "number" && body.resetTimeoutMs > 0) {
        update["resetTimeoutMs"] = body.resetTimeoutMs;
      }
      if (typeof body.halfOpenSuccessThreshold === "number" && body.halfOpenSuccessThreshold > 0) {
        update["halfOpenSuccessThreshold"] = body.halfOpenSuccessThreshold;
      }
      if (Object.keys(update).length === 0) {
        return c.json(
          {
            error: "No valid config fields provided",
            code: "VALIDATION_ERROR"
          },
          400
        );
      }
      cbRegistry.updateDefaultConfig(update);
      const newConfig = cbRegistry.getDefaultConfig();
      return c.json({
        updated: true,
        config: {
          enabled: cbRegistry.isEnabled(),
          failureThreshold: newConfig.failureThreshold,
          backoffBaseMs: newConfig.backoffBaseMs,
          backoffMultiplier: newConfig.backoffMultiplier,
          backoffMaxMs: newConfig.backoffMaxMs,
          resetTimeoutMs: newConfig.resetTimeoutMs,
          halfOpenSuccessThreshold: newConfig.halfOpenSuccessThreshold
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  app.get("/v1/circuit-breaker/stats", (c) => {
    try {
      const cbRegistry = getCircuitBreakerRegistry();
      const stats = cbRegistry.getAllStats();
      return c.json({
        enabled: cbRegistry.isEnabled(),
        breakers: stats
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 500);
    }
  });
  if (comparisonService2) {
    app.post("/v1/compare", async (c) => {
      try {
        const body = await c.req.json();
        let validated;
        try {
          validated = CompareRequestSchema.parse(body);
        } catch (error) {
          if (error && typeof error === "object" && "issues" in error) {
            const issues = error.issues;
            const firstIssue = issues[0];
            return c.json(
              {
                error: firstIssue?.message ?? "Validation error",
                code: "VALIDATION_ERROR",
                field: firstIssue?.path?.join(".") ?? ""
              },
              400
            );
          }
          throw error;
        }
        const result = await comparisonService2.compare(validated);
        return c.json(result);
      } catch (error) {
        if (error instanceof CostExceededError) {
          return c.json(
            {
              error: error.message,
              code: "COST_EXCEEDED",
              estimatedCost: error.estimatedCost,
              limit: error.limit
            },
            422
          );
        }
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 500);
      }
    });
    app.get("/v1/compare/history", (c) => {
      try {
        const project = c.req.query("project") ?? void 0;
        const limitStr = c.req.query("limit");
        const offsetStr = c.req.query("offset");
        const rawLimit = limitStr ? parseInt(limitStr, 10) : 20;
        const limit = Math.min(
          isNaN(rawLimit) ? 20 : Math.max(1, rawLimit),
          100
        );
        const rawOffset = offsetStr ? parseInt(offsetStr, 10) : 0;
        const offset = isNaN(rawOffset) ? 0 : Math.max(0, rawOffset);
        const results = comparisonService2.getHistory({
          project,
          limit,
          offset
        });
        return c.json({ results, count: results.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return c.json({ error: message }, 500);
      }
    });
  }
  registerAdminRoutes(app, {
    router: router2,
    vault: vault2,
    config: config2,
    groupStore: groupStore2,
    costTracker: costTracker2,
    serverStartTime,
    freeModelRouter: freeModelRouter2,
    db: db2
  });
  const server = serve(
    {
      fetch: app.fetch,
      port: config2.httpPort
    },
    (info) => {
      logger.info({ port: info.port }, "HTTP server started");
    }
  );
  return server;
}

// src/server/mcp.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema as ListToolsRequestSchema2,
  CallToolRequestSchema as CallToolRequestSchema2
} from "@modelcontextprotocol/sdk/types.js";

// src/security/enforcer.ts
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
var ProfileEnforcer = class {
  profile;
  rateLimiter;
  allowedCategories;
  _resolver;
  constructor(profileNameOrResolver) {
    this._resolver = typeof profileNameOrResolver === "function" ? profileNameOrResolver : null;
    const profile = typeof profileNameOrResolver === "string" ? PROFILES[profileNameOrResolver] : null;
    if (typeof profileNameOrResolver === "string" && !profile) {
      const valid = Object.keys(PROFILES).join(", ");
      throw new Error(
        `Unknown security profile "${profileNameOrResolver}". Valid profiles: ${valid}`
      );
    }
    this.profile = profile ?? PROFILES["restricted"];
    this.allowedCategories = new Set(this.profile.allowedCategories);
    if (this.profile.rateLimit) {
      this.rateLimiter = new RateLimiter({
        max: this.profile.rateLimit.max,
        windowMs: this.profile.rateLimit.windowMs
      });
    } else {
      this.rateLimiter = null;
    }
    logger.info(
      {
        profile: this.profile.level,
        allowedCategories: this.profile.allowedCategories,
        rateLimit: this.profile.rateLimit,
        mode: this._resolver ? "dynamic-resolver" : "static"
      },
      "Security profile enforcer initialized"
    );
  }
  /**
   * Resolve a project-specific profile using the configured resolver.
   * Falls back to the static default profile if no resolver is set
   * or the resolver returns null for the given project.
   *
   * Returns a SecurityProfile (never null).
   */
  resolveForProject(project) {
    if (!this._resolver) return this.profile;
    const resolved = this._resolver(project);
    return resolved ?? this.profile;
  }
  /**
   * Filter a list of tools to only those allowed by the active profile.
   */
  filterTools(tools) {
    return tools.filter((tool) => {
      const category = TOOL_CATEGORIES[tool.name];
      if (!category) {
        logger.warn(
          { tool: tool.name, profile: this.profile.level },
          "Tool not found in TOOL_CATEGORIES \u2014 blocked by default"
        );
        return false;
      }
      return this.allowedCategories.has(category);
    });
  }
  /**
   * Check if a tool call is authorized under the active profile.
   * Returns true if allowed, false if denied.
   */
  authorize(toolName) {
    const category = TOOL_CATEGORIES[toolName];
    if (!category || !this.allowedCategories.has(category)) {
      logger.warn(
        {
          tool: toolName,
          category: category ?? "unknown",
          profile: this.profile.level
        },
        "Tool call denied by security profile"
      );
      return false;
    }
    return true;
  }
  /**
   * Check rate limit for the active profile.
   * Returns { allowed: true } or { allowed: false, retryAfter: ms }.
   */
  checkRate() {
    if (!this.rateLimiter) {
      return { allowed: true };
    }
    const key = "mcp-security";
    const limited = this.rateLimiter.isRateLimited(key);
    if (limited) {
      const resetAt = this.rateLimiter.getResetAt(key);
      const retryAfter = Math.max(0, resetAt - Date.now());
      return { allowed: false, retryAfter };
    }
    return { allowed: true };
  }
  /**
   * Wrap the MCP server's ListTools and CallTool handlers with
   * profile enforcement. The original handlers are preserved as
   * delegates — this method intercepts before forwarding.
   */
  wrapHandlers(server, tools, handleToolCall2) {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.filterTools(tools)
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      if (!this.authorize(name)) {
        return {
          content: [
            {
              type: "text",
              text: `Access denied: tool "${name}" is not allowed under the "${this.profile.level}" security profile.`
            }
          ],
          isError: true
        };
      }
      const rateResult = this.checkRate();
      if (!rateResult.allowed) {
        return {
          content: [
            {
              type: "text",
              text: `Rate limit exceeded for "${this.profile.level}" profile. Try again in ${Math.ceil((rateResult.retryAfter ?? 0) / 1e3)} seconds.`
            }
          ],
          isError: true
        };
      }
      return handleToolCall2(name, args ?? {});
    });
  }
  /**
   * Cleanup resources (RateLimiter interval).
   */
  destroy() {
    this.rateLimiter?.destroy();
  }
};

// src/server/mcp.ts
var TOOLS = [
  {
    name: "llm_generate",
    description: "Generate text using an LLM. Routes to the best available provider with automatic fallback.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The user prompt to send to the LLM"
        },
        system: {
          type: "string",
          description: "Optional system prompt"
        },
        provider: {
          type: "string",
          description: 'Preferred provider ID (e.g. "anthropic", "openai", "google", "groq", "openrouter", "claude-cli")'
        },
        model: {
          type: "string",
          description: 'Specific model ID (e.g. "claude-sonnet-4-20250514", "gpt-4o", "gemini-2.5-flash", "llama-3.3-70b-versatile")'
        },
        maxTokens: {
          type: "number",
          description: "Maximum output tokens (default: 4096)"
        },
        project: {
          type: "string",
          description: 'Project scope for credential resolution (e.g. "ghagga", "md-evals"). Falls back to global credentials if not found.'
        }
      },
      required: ["prompt"]
    }
  },
  {
    name: "vault_store",
    description: "Store an API key in the encrypted credential vault. Upserts by (provider, keyName, project).",
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          description: 'Provider identifier (e.g. "anthropic", "openai", "google", "groq", "openrouter")'
        },
        keyName: {
          type: "string",
          description: 'Key slot name (default: "default")'
        },
        apiKey: {
          type: "string",
          description: "The API key to store"
        },
        project: {
          type: "string",
          description: 'Project scope (default: "_global" \u2014 shared by all projects)'
        }
      },
      required: ["provider", "apiKey"]
    }
  },
  {
    name: "vault_list",
    description: "List all stored credentials with masked values. Optionally filter by project.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Filter by project (shows project-specific + global). Omit to show all."
        }
      }
    }
  },
  {
    name: "vault_delete",
    description: "Delete a stored credential by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "Credential row ID to delete"
        }
      },
      required: ["id"]
    }
  },
  {
    name: "llm_models",
    description: "List all available models across registered providers.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "vault_store_file",
    description: "Store an auth file (e.g. auth.json) in the encrypted vault. Upserts by (provider, fileName, project).",
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          description: 'Provider identifier (e.g. "opencode")'
        },
        fileName: {
          type: "string",
          description: 'File name (e.g. "auth.json")'
        },
        content: {
          type: "string",
          description: "File content as a string"
        },
        project: {
          type: "string",
          description: 'Project scope (default: "_global" \u2014 shared by all projects)'
        }
      },
      required: ["provider", "fileName", "content"]
    }
  },
  {
    name: "vault_list_files",
    description: "List all stored auth files (metadata only). Optionally filter by project.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Filter by project (shows project-specific + global). Omit to show all."
        }
      }
    }
  },
  {
    name: "vault_delete_file",
    description: "Delete a stored auth file by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "File row ID to delete"
        }
      },
      required: ["id"]
    }
  },
  {
    name: "list_groups",
    description: "List all provider groups for load balancing.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "create_group",
    description: "Create a new provider group for load balancing.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: 'Group name (e.g. "anthropic-keys", "fast-models")'
        },
        modelPattern: {
          type: "string",
          description: 'Glob pattern to match model names (e.g. "claude-*", "gpt-*,claude-*")'
        },
        members: {
          type: "array",
          description: "Array of provider members: [{ provider, keyName?, weight?, priority? }]",
          items: {
            type: "object",
            properties: {
              provider: { type: "string" },
              keyName: { type: "string" },
              weight: { type: "number" },
              priority: { type: "number" }
            },
            required: ["provider"]
          }
        },
        strategy: {
          type: "string",
          description: 'Balancing strategy: "round-robin", "random", "failover", "weighted"'
        },
        stickyTTL: {
          type: "number",
          description: "Session stickiness TTL in seconds (optional)"
        }
      },
      required: ["name", "members", "strategy"]
    }
  },
  {
    name: "delete_group",
    description: "Delete a provider group by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Group ID to delete"
        }
      },
      required: ["id"]
    }
  },
  {
    name: "configure_circuit_breaker",
    description: "Configure circuit breaker settings. Updates thresholds and backoff for all breakers.",
    inputSchema: {
      type: "object",
      properties: {
        failureThreshold: {
          type: "number",
          description: "Number of failures before opening (default: 5)"
        },
        backoffBaseMs: {
          type: "number",
          description: "Exponential backoff base in ms (default: 5000). Set to enable backoff."
        },
        backoffMultiplier: {
          type: "number",
          description: "Exponential backoff multiplier (default: 2)"
        },
        backoffMaxMs: {
          type: "number",
          description: "Maximum backoff cap in ms (default: 300000 = 5 min)"
        },
        resetTimeoutMs: {
          type: "number",
          description: "Fixed timeout before half-open in ms (default: 30000)"
        }
      }
    }
  },
  {
    name: "circuit_breaker_stats",
    description: "Get circuit breaker stats for all providers. Shows state, failures, successes, cooldown.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "usage_summary",
    description: "Get cost/usage summary. Returns total requests, tokens, cost, with optional breakdown by provider, model, project, hour, or day.",
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          description: "Filter by provider"
        },
        model: {
          type: "string",
          description: "Filter by model"
        },
        project: {
          type: "string",
          description: "Filter by project"
        },
        from: {
          type: "string",
          description: 'Start date (ISO format, e.g. "2026-03-01")'
        },
        to: {
          type: "string",
          description: 'End date (ISO format, e.g. "2026-03-23")'
        },
        groupBy: {
          type: "string",
          description: 'Group breakdown by: "provider", "model", "project", "hour", "day"'
        }
      }
    }
  },
  {
    name: "usage_query",
    description: "Query individual usage records with filters. Returns raw usage log entries.",
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          description: "Filter by provider"
        },
        model: {
          type: "string",
          description: "Filter by model"
        },
        project: {
          type: "string",
          description: "Filter by project"
        },
        from: {
          type: "string",
          description: "Start date (ISO format)"
        },
        to: {
          type: "string",
          description: "End date (ISO format)"
        },
        limit: {
          type: "number",
          description: "Maximum records to return (default: 100)"
        }
      }
    }
  },
  {
    name: "code_search",
    description: "Search code semantically. Finds functions, classes, and blocks matching a query using keyword + fuzzy matching. Optionally follows imports for related code.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Search query (e.g. "authentication middleware", "database connection")'
        },
        scope: {
          type: "string",
          description: "Directory path to limit search scope (default: current working directory)"
        },
        limit: {
          type: "number",
          description: "Maximum results to return (default: 10, max: 50)"
        },
        followImports: {
          type: "boolean",
          description: "Follow imports to find related code chunks (default: false)"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "index_codebase",
    description: "Index a codebase directory for semantic code search. Scans files, extracts functions/classes/blocks, and builds an in-memory search index.",
    inputSchema: {
      type: "object",
      properties: {
        rootDir: {
          type: "string",
          description: "Root directory to index (default: current working directory)"
        },
        extensions: {
          type: "array",
          description: "File extensions to index (default: .ts, .js, .py, .go, .rs, etc.)",
          items: { type: "string" }
        },
        ignorePatterns: {
          type: "array",
          description: "Directory names to ignore (default: node_modules, .git, dist, etc.)",
          items: { type: "string" }
        }
      }
    }
  },
  {
    name: "shared_state",
    description: "CRDT-based shared state for multi-agent collaboration. Supports conflict-free read/write/merge with G-Counter (token tracking), LWW-Register (agent status), and OR-Set (shared findings).",
    inputSchema: {
      type: "object",
      properties: {
        op: {
          type: "string",
          description: 'Operation: "read", "write", "merge", "snapshot", or "list"'
        },
        key: {
          type: "string",
          description: "Container key name (required for read/write)"
        },
        type: {
          type: "string",
          description: 'CRDT type: "g-counter", "lww-register", or "or-set" (required for write)'
        },
        nodeId: {
          type: "string",
          description: "Agent/node identifier (required for write)"
        },
        value: {
          description: "Value to write (semantics depend on type)"
        },
        amount: {
          type: "number",
          description: "Increment amount for g-counter (default: 1)"
        },
        element: {
          type: "string",
          description: "Element to add/remove for or-set"
        },
        action: {
          type: "string",
          description: 'Action for or-set: "add" or "remove"'
        },
        snapshot: {
          type: "object",
          description: "State snapshot to merge (required for merge op)"
        }
      },
      required: ["op"]
    }
  }
];
async function handleToolCall(toolName, args, router2, vault2, groupStore2, costTracker2, bridge2, codeSearch2, stateManager2) {
  try {
    switch (toolName) {
      case "llm_generate": {
        const request = {
          prompt: args["prompt"],
          system: args["system"],
          provider: args["provider"],
          model: args["model"],
          maxTokens: args["maxTokens"],
          project: args["project"]
        };
        if (bridge2 && !request.provider && !request.model) {
          const result2 = await bridge2.generate(request);
          return {
            content: [{ type: "text", text: JSON.stringify(result2) }]
          };
        }
        const result = await router2.generate(request);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        };
      }
      case "vault_store": {
        const id = vault2.store(
          args["provider"],
          args["keyName"] ?? "default",
          args["apiKey"],
          args["project"]
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                id,
                provider: args["provider"],
                keyName: args["keyName"] ?? "default",
                project: args["project"] ?? "_global"
              })
            }
          ]
        };
      }
      case "vault_list": {
        const credentials = vault2.listMasked(
          args["project"]
        );
        return {
          content: [{ type: "text", text: JSON.stringify(credentials) }]
        };
      }
      case "vault_delete": {
        vault2.delete(args["id"]);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true }) }]
        };
      }
      case "llm_models": {
        const models = await router2.getAvailableModels();
        return {
          content: [{ type: "text", text: JSON.stringify(models) }]
        };
      }
      case "vault_store_file": {
        const id = vault2.storeFile(
          args["provider"],
          args["fileName"],
          args["content"],
          args["project"]
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                id,
                provider: args["provider"],
                fileName: args["fileName"],
                project: args["project"] ?? "_global"
              })
            }
          ]
        };
      }
      case "vault_list_files": {
        const files = vault2.listFiles(
          args["project"]
        );
        return {
          content: [{ type: "text", text: JSON.stringify(files) }]
        };
      }
      case "vault_delete_file": {
        vault2.deleteFile(args["id"]);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true }) }]
        };
      }
      case "list_groups": {
        if (!groupStore2) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "Group store not configured" }) }],
            isError: true
          };
        }
        const groups = groupStore2.list();
        return {
          content: [{ type: "text", text: JSON.stringify(groups) }]
        };
      }
      case "create_group": {
        if (!groupStore2) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "Group store not configured" }) }],
            isError: true
          };
        }
        const validated = CreateGroupSchema.parse(args);
        const group = groupStore2.create(validated);
        return {
          content: [{ type: "text", text: JSON.stringify(group) }]
        };
      }
      case "delete_group": {
        if (!groupStore2) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "Group store not configured" }) }],
            isError: true
          };
        }
        const deleted = groupStore2.delete(args["id"]);
        if (!deleted) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `Group not found: ${args["id"]}` }) }],
            isError: true
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true }) }]
        };
      }
      case "configure_circuit_breaker": {
        const cbRegistry = getCircuitBreakerRegistry();
        const update = {};
        if (typeof args["failureThreshold"] === "number") update["failureThreshold"] = args["failureThreshold"];
        if (typeof args["backoffBaseMs"] === "number") update["backoffBaseMs"] = args["backoffBaseMs"];
        if (typeof args["backoffMultiplier"] === "number") update["backoffMultiplier"] = args["backoffMultiplier"];
        if (typeof args["backoffMaxMs"] === "number") update["backoffMaxMs"] = args["backoffMaxMs"];
        if (typeof args["resetTimeoutMs"] === "number") update["resetTimeoutMs"] = args["resetTimeoutMs"];
        cbRegistry.updateDefaultConfig(update);
        const newConfig = cbRegistry.getDefaultConfig();
        return {
          content: [{ type: "text", text: JSON.stringify({ updated: true, config: newConfig }) }]
        };
      }
      case "circuit_breaker_stats": {
        const cbRegistry = getCircuitBreakerRegistry();
        const stats = cbRegistry.getAllStats();
        return {
          content: [{ type: "text", text: JSON.stringify({ enabled: cbRegistry.isEnabled(), breakers: stats }) }]
        };
      }
      case "usage_summary": {
        if (!costTracker2) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "Cost tracker not configured" }) }],
            isError: true
          };
        }
        const summary = costTracker2.summary({
          provider: args["provider"],
          model: args["model"],
          project: args["project"],
          from: args["from"],
          to: args["to"],
          groupBy: args["groupBy"]
        });
        return {
          content: [{ type: "text", text: JSON.stringify(summary) }]
        };
      }
      case "usage_query": {
        if (!costTracker2) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "Cost tracker not configured" }) }],
            isError: true
          };
        }
        const records = costTracker2.query({
          provider: args["provider"],
          model: args["model"],
          project: args["project"],
          from: args["from"],
          to: args["to"],
          limit: args["limit"] ?? 100
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ records, count: records.length }) }]
        };
      }
      case "code_search": {
        if (!codeSearch2) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "Code search not configured" }) }],
            isError: true
          };
        }
        const searchQuery = args["query"];
        if (!searchQuery?.trim()) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "Query is required and must not be empty" }) }],
            isError: true
          };
        }
        const results = codeSearch2.search({
          query: searchQuery,
          scope: args["scope"] ?? process.cwd(),
          limit: args["limit"],
          followImports: args["followImports"]
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ results, count: results.length }) }]
        };
      }
      case "index_codebase": {
        if (!codeSearch2) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "Code search not configured" }) }],
            isError: true
          };
        }
        const rootDir = args["rootDir"] ?? process.cwd();
        const chunks = codeSearch2.reindex(rootDir);
        return {
          content: [{ type: "text", text: JSON.stringify({ indexed: true, rootDir, chunks }) }]
        };
      }
      case "shared_state": {
        if (!stateManager2) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "State manager not configured" }) }],
            isError: true
          };
        }
        const op = args["op"];
        switch (op) {
          case "read": {
            const readKey = args["key"];
            if (!readKey) {
              return {
                content: [{ type: "text", text: JSON.stringify({ error: "key is required for read" }) }],
                isError: true
              };
            }
            const result = stateManager2.read(readKey);
            return {
              content: [{ type: "text", text: JSON.stringify(result ?? { error: `Key not found: ${readKey}` }) }],
              isError: !result
            };
          }
          case "write": {
            const writeKey = args["key"];
            const crdtType = args["type"];
            const writeNodeId = args["nodeId"];
            if (!writeKey || !crdtType || !writeNodeId) {
              return {
                content: [{ type: "text", text: JSON.stringify({ error: "key, type, and nodeId are required for write" }) }],
                isError: true
              };
            }
            if (crdtType === "g-counter") {
              stateManager2.write(writeKey, "g-counter", {
                nodeId: writeNodeId,
                amount: args["amount"] ?? 1
              });
            } else if (crdtType === "lww-register") {
              stateManager2.write(writeKey, "lww-register", {
                value: args["value"],
                nodeId: writeNodeId,
                timestamp: args["timestamp"]
              });
            } else if (crdtType === "or-set") {
              const setAction = args["action"] ?? "add";
              const element = args["element"];
              if (!element) {
                return {
                  content: [{ type: "text", text: JSON.stringify({ error: "element is required for or-set write" }) }],
                  isError: true
                };
              }
              stateManager2.write(writeKey, "or-set", {
                action: setAction,
                element,
                nodeId: writeNodeId
              });
            } else {
              return {
                content: [{ type: "text", text: JSON.stringify({ error: `Unknown CRDT type: ${crdtType}` }) }],
                isError: true
              };
            }
            const written = stateManager2.read(writeKey);
            return {
              content: [{ type: "text", text: JSON.stringify({ ok: true, key: writeKey, ...written }) }]
            };
          }
          case "merge": {
            const incoming = args["snapshot"];
            if (!incoming) {
              return {
                content: [{ type: "text", text: JSON.stringify({ error: "snapshot is required for merge" }) }],
                isError: true
              };
            }
            stateManager2.mergeSnapshot(incoming);
            return {
              content: [{ type: "text", text: JSON.stringify({ ok: true, merged: Object.keys(incoming.entries).length }) }]
            };
          }
          case "snapshot": {
            const snap = stateManager2.snapshot();
            return {
              content: [{ type: "text", text: JSON.stringify(snap) }]
            };
          }
          case "list": {
            const containers = stateManager2.list();
            return {
              content: [{ type: "text", text: JSON.stringify({ containers }) }]
            };
          }
          default:
            return {
              content: [{ type: "text", text: JSON.stringify({ error: `Unknown operation: ${op}` }) }],
              isError: true
            };
        }
      }
      default:
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: `Unknown tool: ${toolName}` }) }
          ],
          isError: true
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: JSON.stringify({ error: message }) }],
      isError: true
    };
  }
}
async function startMcpServer(router2, vault2, groupStore2, costTracker2, bridge2, codeSearch2, stateManager2, securityProfile) {
  const server = new Server(
    {
      name: "mcp-llm-bridge",
      version: VERSION
    },
    {
      capabilities: { tools: {} }
    }
  );
  server.setRequestHandler(ListToolsRequestSchema2, async () => ({
    tools: [...TOOLS]
  }));
  server.setRequestHandler(CallToolRequestSchema2, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(name, args ?? {}, router2, vault2, groupStore2, costTracker2, bridge2, codeSearch2, stateManager2);
  });
  let enforcer;
  const profileName = securityProfile ?? "local-dev";
  if (profileName !== "local-dev") {
    enforcer = new ProfileEnforcer(profileName);
    enforcer.wrapHandlers(
      server,
      TOOLS,
      (name, args) => handleToolCall(name, args, router2, vault2, groupStore2, costTracker2, bridge2, codeSearch2, stateManager2)
    );
  }
  const { wrapWithPageIndex } = await import("./mcp-integration-RSUGTUHQ.js");
  wrapWithPageIndex(server, vault2?.getDb?.());
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info({ securityProfile: profileName }, "MCP server started on stdio");
  return server;
}

// src/vault/vault.ts
import Database3 from "better-sqlite3";
import { existsSync as existsSync9, mkdirSync as mkdirSync7 } from "fs";
import { dirname as dirname7 } from "path";

// src/vault/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes as randomBytes4 } from "crypto";
var ALGORITHM = "aes-256-gcm";
var IV_BYTES = 12;
function encrypt(plaintext, masterKey) {
  const iv = randomBytes4(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  return { encrypted, iv, authTag };
}
function decrypt(data, masterKey) {
  const decipher = createDecipheriv(ALGORITHM, masterKey, data.iv);
  decipher.setAuthTag(data.authTag);
  return Buffer.concat([
    decipher.update(data.encrypted),
    decipher.final()
  ]).toString("utf8");
}

// src/vault/claude-oauth.ts
import { existsSync as existsSync8, readFileSync as readFileSync6, writeFileSync as writeFileSync4, mkdirSync as mkdirSync6 } from "fs";
import { homedir as homedir4 } from "os";
import { join as join7, dirname as dirname6 } from "path";
var CLAUDE_CREDENTIALS_PATH = join7(homedir4(), ".claude", ".credentials.json");
var OPENCODE_AUTH_PATH = join7(homedir4(), ".local", "share", "opencode", "auth.json");
var TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1e3;
function readClaudeOAuthToken() {
  try {
    if (!existsSync8(CLAUDE_CREDENTIALS_PATH)) {
      return null;
    }
    const content = readFileSync6(CLAUDE_CREDENTIALS_PATH, "utf-8");
    const creds = JSON.parse(content);
    if (!creds.access_token || typeof creds.access_token !== "string") {
      return null;
    }
    return {
      accessToken: creds.access_token,
      refreshToken: creds.refresh_token,
      expiresAt: creds.expires_at
    };
  } catch (error) {
    return null;
  }
}
function isTokenExpiringSoon(token) {
  if (!token.expiresAt) {
    return false;
  }
  const now = Date.now();
  const timeUntilExpiry = token.expiresAt - now;
  return timeUntilExpiry <= TOKEN_EXPIRY_BUFFER_MS;
}
async function refreshTokenIfNeeded(token) {
  if (!isTokenExpiringSoon(token)) {
    return token;
  }
  if (!token.refreshToken) {
    return token;
  }
  console.warn("[claude-oauth] Token refresh not yet implemented. Consider re-authenticating with Claude CLI.");
  return token;
}
function syncToOpencodeAuth(token, _project) {
  try {
    const dir = dirname6(OPENCODE_AUTH_PATH);
    if (!existsSync8(dir)) {
      mkdirSync6(dir, { recursive: true, mode: 448 });
    }
    const authData = {
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      expires_at: token.expiresAt,
      provider: "claude-cli",
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    writeFileSync4(OPENCODE_AUTH_PATH, JSON.stringify(authData, null, 2), "utf-8");
    return true;
  } catch (error) {
    console.error("[claude-oauth] Failed to sync to opencode auth:", error);
    return false;
  }
}

// src/vault/vault.ts
var vaultAuditLogger = childLogger({ component: "vault-audit" });
var Vault = class {
  db;
  masterKey;
  _destroyed = false;
  /**
   * Expose the underlying database connection for modules that need direct access
   * (e.g., auth middleware, admin key CRUD).
   */
  getDb() {
    return this.db;
  }
  constructor(config2) {
    this.masterKey = config2.masterKey;
    const dir = dirname7(config2.dbPath);
    if (!existsSync9(dir)) {
      mkdirSync7(dir, { recursive: true, mode: 448 });
    }
    this.db = new Database3(config2.dbPath);
    this.db.pragma("journal_mode = WAL");
    initializeDb(this.db);
  }
  // ── Private helpers for project/global lookup ──────────────
  /**
   * Resolve project: if provided and not _global, return it; otherwise _global.
   */
  resolveProject(project) {
    return project && project !== GLOBAL_PROJECT ? project : GLOBAL_PROJECT;
  }
  /**
   * Find a credential row with project-first then global fallback.
   * Returns the decrypted value if found, or null if not found.
   */
  findCredentialDecrypted(provider, keyName, project) {
    const resolved = this.resolveProject(project);
    const projectRow = this.db.prepare("SELECT encrypted_value, iv, auth_tag FROM credentials WHERE provider = ? AND key_name = ? AND project = ?").get(provider, keyName, resolved);
    if (projectRow) {
      return this.decryptRow(projectRow);
    }
    if (project && project !== GLOBAL_PROJECT) {
      const globalRow = this.db.prepare("SELECT encrypted_value, iv, auth_tag FROM credentials WHERE provider = ? AND key_name = ? AND project = ?").get(provider, keyName, GLOBAL_PROJECT);
      if (globalRow) {
        return this.decryptRow(globalRow);
      }
    }
    return null;
  }
  /**
   * Check if a credential exists with project-first then global fallback.
   * Uses a single query with ORDER BY for efficient lookup.
   */
  hasCredential(provider, keyName, project) {
    if (project && project !== GLOBAL_PROJECT) {
      const row = this.db.prepare("SELECT project FROM credentials WHERE provider = ? AND key_name = ? AND project IN (?, ?) ORDER BY CASE WHEN project = ? THEN 0 ELSE 1 END LIMIT 1").get(provider, keyName, project, GLOBAL_PROJECT, project);
      return !!row;
    }
    return !!this.db.prepare("SELECT 1 FROM credentials WHERE provider = ? AND key_name = ? AND project = ?").get(provider, keyName, GLOBAL_PROJECT);
  }
  /**
   * Find a file row with project-first then global fallback.
   * Returns the decrypted content if found, or null if not found.
   */
  findFileDecrypted(provider, fileName, project) {
    const resolved = this.resolveProject(project);
    const projectRow = this.db.prepare("SELECT encrypted_value, iv, auth_tag FROM files WHERE provider = ? AND file_name = ? AND project = ?").get(provider, fileName, resolved);
    if (projectRow) {
      return this.decryptRow(projectRow);
    }
    if (project && project !== GLOBAL_PROJECT) {
      const globalRow = this.db.prepare("SELECT encrypted_value, iv, auth_tag FROM files WHERE provider = ? AND file_name = ? AND project = ?").get(provider, fileName, GLOBAL_PROJECT);
      if (globalRow) {
        return this.decryptRow(globalRow);
      }
    }
    return null;
  }
  /**
   * Check if a file exists with project-first then global fallback.
   * Uses a single query with ORDER BY for efficient lookup.
   */
  hasFileImpl(provider, fileName, project) {
    if (project && project !== GLOBAL_PROJECT) {
      const row = this.db.prepare("SELECT project FROM files WHERE provider = ? AND file_name = ? AND project IN (?, ?) ORDER BY CASE WHEN project = ? THEN 0 ELSE 1 END LIMIT 1").get(provider, fileName, project, GLOBAL_PROJECT, project);
      return !!row;
    }
    return !!this.db.prepare("SELECT 1 FROM files WHERE provider = ? AND file_name = ? AND project = ?").get(provider, fileName, GLOBAL_PROJECT);
  }
  /**
   * Decrypt an encrypted credential row.
   */
  decryptRow(row) {
    return decrypt(
      {
        encrypted: row.encrypted_value,
        iv: row.iv,
        authTag: row.auth_tag
      },
      this.masterKey
    );
  }
  // ── Public API ─────────────────────────────────────────────
  /**
   * Store (upsert) an encrypted credential.
   *
   * If a credential with the same (provider, keyName, project) already exists,
   * it is updated with the new encrypted value.
   *
   * @param project - Project scope (defaults to '_global')
   * @returns The row id of the stored credential
   */
  store(provider, keyName, apiKey, project) {
    const proj = project ?? GLOBAL_PROJECT;
    try {
      const { encrypted, iv, authTag } = encrypt(apiKey, this.masterKey);
      const stmt = this.db.prepare(`
        INSERT INTO credentials (provider, key_name, project, encrypted_value, iv, auth_tag, length_hint, updated_at)
        VALUES (@provider, @keyName, @project, @encrypted, @iv, @authTag, @lengthHint, datetime('now'))
        ON CONFLICT(provider, key_name, project) DO UPDATE SET
          encrypted_value = @encrypted,
          iv              = @iv,
          auth_tag        = @authTag,
          length_hint     = @lengthHint,
          updated_at      = datetime('now')
      `);
      const result = stmt.run({
        provider,
        keyName,
        project: proj,
        encrypted,
        iv,
        authTag,
        lengthHint: apiKey.length
      });
      vaultAuditLogger.info({ action: "store", provider, keyName, project: proj, success: true });
      return Number(result.lastInsertRowid);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vaultAuditLogger.error({ action: "store", provider, keyName, project: proj, success: false, error: message });
      throw err;
    }
  }
  /**
   * Retrieve and decrypt an API key.
   *
   * When a project is specified, tries project-specific first,
   * then falls back to '_global'.
   *
   * @param provider - Provider identifier (e.g. "anthropic", "openai")
   * @param keyName - Key slot name (defaults to "default")
   * @param project - Project scope (tries project-specific first, then '_global')
   * @throws Error if no credential is found for the given provider/keyName
   */
  getDecrypted(provider, keyName = "default", project) {
    const proj = this.resolveProject(project);
    try {
      const decrypted = this.findCredentialDecrypted(provider, keyName, project);
      if (!decrypted) {
        const scopeInfo = project && project !== GLOBAL_PROJECT ? ` (checked project "${project}" and global)` : "";
        throw new Error(
          `No credential found for provider "${provider}" with key name "${keyName}"${scopeInfo}.`
        );
      }
      vaultAuditLogger.info({ action: "access", provider, keyName, project: proj, success: true });
      return decrypted;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vaultAuditLogger.error({ action: "access", provider, keyName, project: proj, success: false, error: message });
      throw err;
    }
  }
  /**
   * Check whether a credential exists for the given provider/keyName.
   *
   * When a project is specified, checks project-specific first, then '_global'.
   */
  has(provider, keyName = "default", project) {
    return this.hasCredential(provider, keyName, project);
  }
  /**
   * List all credentials with masked values (safe for display).
   *
   * If project is specified, returns project-specific + global credentials.
   * If not specified, returns all credentials.
   */
  listMasked(project) {
    const proj = project ?? GLOBAL_PROJECT;
    try {
      let rows;
      if (project) {
        rows = this.db.prepare(
          "SELECT id, provider, key_name, project, encrypted_value, iv, auth_tag, created_at, updated_at FROM credentials WHERE project = ? OR project = ? ORDER BY provider, key_name, project"
        ).all(project, GLOBAL_PROJECT);
      } else {
        rows = this.db.prepare(
          "SELECT id, provider, key_name, project, encrypted_value, iv, auth_tag, created_at, updated_at FROM credentials ORDER BY provider, key_name, project"
        ).all();
      }
      const result = rows.map((row) => {
        let maskedValue;
        if (row.length_hint != null) {
          maskedValue = this.maskByLength(row.length_hint);
        } else {
          const decrypted = decrypt(
            {
              encrypted: row.encrypted_value,
              iv: row.iv,
              authTag: row.auth_tag
            },
            this.masterKey
          );
          maskedValue = this.mask(decrypted);
        }
        return {
          id: row.id,
          provider: row.provider,
          keyName: row.key_name,
          project: row.project,
          maskedValue,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      });
      vaultAuditLogger.info({ action: "list", provider: "*", project: proj, success: true });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vaultAuditLogger.error({ action: "list", provider: "*", project: proj, success: false, error: message });
      throw err;
    }
  }
  /**
   * Delete a credential by its row id.
   * 
   * Authorization: Only allows deletion if the credential belongs to
   * the specified project (or is global), preventing IDOR attacks.
   * 
   * @param id - The credential row id
   * @param project - The project scope to authorize against (optional)
   * @throws Error if credential not found or unauthorized
   */
  delete(id, project) {
    const row = this.db.prepare("SELECT project, provider, key_name FROM credentials WHERE id = ?").get(id);
    if (!row) {
      const err = new Error(`Credential not found: id ${id}`);
      vaultAuditLogger.error({ action: "delete", provider: "unknown", project: project ?? GLOBAL_PROJECT, success: false, error: err.message });
      throw err;
    }
    const isGlobal = row.project === GLOBAL_PROJECT;
    const isSameProject = row.project === project;
    if (!isGlobal && !isSameProject) {
      const err = new Error(
        `Unauthorized: credential belongs to project "${row.project}", not "${project ?? "_global"}"`
      );
      vaultAuditLogger.error({ action: "delete", provider: row.provider, keyName: row.key_name, project: row.project, success: false, error: err.message });
      throw err;
    }
    this.db.prepare("DELETE FROM credentials WHERE id = ?").run(id);
    vaultAuditLogger.info({ action: "delete", provider: row.provider, keyName: row.key_name, project: row.project, success: true });
  }
  /**
   * Mask a value for safe display.
   *
   * Shows the first 7 characters followed by `...***`.
   * For short values (≤ 7 chars), shows proportionally less.
   */
  mask(value) {
    if (value.length <= 4) {
      return "***";
    }
    const visible = Math.min(MASK_VISIBLE_CHARS, value.length - 3);
    return value.slice(0, visible) + MASK_SUFFIX;
  }
  /**
   * Mask a value based on its length (without needing the actual value).
   * Used for lazy masking when length_hint is available.
   */
  maskByLength(length) {
    if (length <= 4) {
      return "***";
    }
    const visible = Math.min(MASK_VISIBLE_CHARS, length - 3);
    return "\u2588".repeat(visible) + MASK_SUFFIX;
  }
  // ── File Storage ──────────────────────────────────────────
  /**
   * Store (upsert) an encrypted file.
   *
   * If a file with the same (provider, fileName, project) already exists,
   * it is updated with the new encrypted content.
   *
   * @param provider - Provider identifier (e.g. "opencode")
   * @param fileName - File name (e.g. "auth.json")
   * @param content - File content as a string
   * @param project - Project scope (defaults to '_global')
   * @returns The row id of the stored file
   */
  storeFile(provider, fileName, content, project) {
    const proj = project ?? GLOBAL_PROJECT;
    try {
      const { encrypted, iv, authTag } = encrypt(content, this.masterKey);
      const stmt = this.db.prepare(`
        INSERT INTO files (provider, file_name, project, encrypted_value, iv, auth_tag, updated_at)
        VALUES (@provider, @fileName, @project, @encrypted, @iv, @authTag, datetime('now'))
        ON CONFLICT(provider, file_name, project) DO UPDATE SET
          encrypted_value = @encrypted,
          iv              = @iv,
          auth_tag        = @authTag,
          updated_at      = datetime('now')
      `);
      const result = stmt.run({
        provider,
        fileName,
        project: proj,
        encrypted,
        iv,
        authTag
      });
      vaultAuditLogger.info({ action: "store_file", provider, fileName, project: proj, success: true });
      return Number(result.lastInsertRowid);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vaultAuditLogger.error({ action: "store_file", provider, fileName, project: proj, success: false, error: message });
      throw err;
    }
  }
  /**
   * Retrieve and decrypt a stored file.
   *
   * When a project is specified, tries project-specific first,
   * then falls back to '_global'.
   *
   * @returns Decrypted file content, or null if not found
   */
  getFile(provider, fileName, project) {
    return this.findFileDecrypted(provider, fileName, project);
  }
  /**
   * Check whether a file exists for the given provider/fileName.
   *
   * When a project is specified, checks project-specific first, then '_global'.
   */
  hasFile(provider, fileName, project) {
    return this.hasFileImpl(provider, fileName, project);
  }
  /**
   * Delete a stored file by its row id.
   * 
   * Authorization: Only allows deletion if the file belongs to
   * the specified project (or is global), preventing IDOR attacks.
   * 
   * @param id - The file row id
   * @param project - The project scope to authorize against (optional)
   * @throws Error if file not found or unauthorized
   */
  deleteFile(id, project) {
    const row = this.db.prepare("SELECT project, provider, file_name FROM files WHERE id = ?").get(id);
    if (!row) {
      const err = new Error(`File not found: id ${id}`);
      vaultAuditLogger.error({ action: "delete_file", provider: "unknown", project: project ?? GLOBAL_PROJECT, success: false, error: err.message });
      throw err;
    }
    const isGlobal = row.project === GLOBAL_PROJECT;
    const isSameProject = row.project === project;
    if (!isGlobal && !isSameProject) {
      const err = new Error(
        `Unauthorized: file belongs to project "${row.project}", not "${project ?? "_global"}"`
      );
      vaultAuditLogger.error({ action: "delete_file", provider: row.provider, fileName: row.file_name, project: row.project, success: false, error: err.message });
      throw err;
    }
    this.db.prepare("DELETE FROM files WHERE id = ?").run(id);
    vaultAuditLogger.info({ action: "delete_file", provider: row.provider, fileName: row.file_name, project: row.project, success: true });
  }
  /**
   * List all stored files (metadata only, no content).
   *
   * If project is specified, returns project-specific + global files.
   * If not specified, returns all files.
   */
  listFiles(project) {
    let rows;
    if (project) {
      rows = this.db.prepare(
        "SELECT id, provider, file_name, project, created_at FROM files WHERE project = ? OR project = ? ORDER BY provider, file_name, project"
      ).all(project, GLOBAL_PROJECT);
    } else {
      rows = this.db.prepare(
        "SELECT id, provider, file_name, project, created_at FROM files ORDER BY provider, file_name, project"
      ).all();
    }
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      fileName: row.file_name,
      project: row.project,
      createdAt: row.created_at
    }));
  }
  /**
   * List stored files for a single provider.
   *
   * If project is specified, returns project-specific files first and then
   * global files that are not overridden by project-specific filenames.
   * If no project is specified, returns only global files for the provider.
   */
  listProviderFiles(provider, project) {
    if (project && project !== GLOBAL_PROJECT) {
      const rows2 = this.db.prepare(
        "SELECT id, provider, file_name, project, created_at FROM files WHERE provider = ? AND (project = ? OR project = ?) ORDER BY CASE WHEN project = ? THEN 0 ELSE 1 END, file_name"
      ).all(provider, project, GLOBAL_PROJECT, project);
      const seen = /* @__PURE__ */ new Set();
      const result = [];
      for (const row of rows2) {
        if (seen.has(row.file_name)) {
          continue;
        }
        seen.add(row.file_name);
        result.push({
          id: row.id,
          provider: row.provider,
          fileName: row.file_name,
          project: row.project,
          createdAt: row.created_at
        });
      }
      return result;
    }
    const rows = this.db.prepare(
      "SELECT id, provider, file_name, project, created_at FROM files WHERE provider = ? AND project = ? ORDER BY file_name"
    ).all(provider, GLOBAL_PROJECT);
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      fileName: row.file_name,
      project: row.project,
      createdAt: row.created_at
    }));
  }
  /**
   * Retrieve decrypted files for a single provider.
   *
   * If project is specified, project-specific files override global files
   * with the same filename. If no project is specified, only global files
   * are returned.
   */
  getProviderFiles(provider, project) {
    if (project && project !== GLOBAL_PROJECT) {
      const rows2 = this.db.prepare(
        "SELECT file_name, project, encrypted_value, iv, auth_tag FROM files WHERE provider = ? AND (project = ? OR project = ?) ORDER BY CASE WHEN project = ? THEN 0 ELSE 1 END, file_name"
      ).all(provider, project, GLOBAL_PROJECT, project);
      const seen = /* @__PURE__ */ new Set();
      const result = [];
      for (const row of rows2) {
        if (seen.has(row.file_name)) {
          continue;
        }
        seen.add(row.file_name);
        result.push({
          fileName: row.file_name,
          content: decrypt(
            {
              encrypted: row.encrypted_value,
              iv: row.iv,
              authTag: row.auth_tag
            },
            this.masterKey
          ),
          project: row.project
        });
      }
      return result;
    }
    const rows = this.db.prepare(
      "SELECT file_name, project, encrypted_value, iv, auth_tag FROM files WHERE provider = ? AND project = ? ORDER BY file_name"
    ).all(provider, GLOBAL_PROJECT);
    return rows.map((row) => ({
      fileName: row.file_name,
      content: decrypt(
        {
          encrypted: row.encrypted_value,
          iv: row.iv,
          authTag: row.auth_tag
        },
        this.masterKey
      ),
      project: row.project
    }));
  }
  // ── Claude CLI OAuth Integration ─────────────────────────────
  /**
   * Get Claude OAuth token from CLI credentials, with automatic refresh and sync.
   *
   * This method:
   * 1. Reads the OAuth token from ~/.claude/.credentials.json
   * 2. Checks if the token needs refresh (within 5 minutes of expiry)
   * 3. Attempts refresh if needed
   * 4. Syncs the credentials to ~/.local/share/opencode/auth.json
   * 5. Returns the access token
   *
   * @param project - Optional project identifier (for future multi-tenant use)
   * @returns The OAuth access token, or null if not available
   */
  async getClaudeOAuthToken(project) {
    let token = readClaudeOAuthToken();
    if (!token) {
      return null;
    }
    if (token.refreshToken) {
      try {
        token = await refreshTokenIfNeeded(token);
      } catch (error) {
        console.warn("[vault] Token refresh failed, using existing token:", error);
      }
    }
    syncToOpencodeAuth(token, project);
    return token;
  }
  /**
   * Get Claude OAuth token synchronously (without refresh).
   *
   * Use this for quick lookups where you don't want async overhead.
   * Does not trigger refresh or sync.
   *
   * @returns The OAuth access token, or null if not available
   */
  getClaudeOAuthTokenSync() {
    const token = readClaudeOAuthToken();
    return token?.accessToken ?? null;
  }
  /**
   * Whether this vault has been destroyed (master key zeroed).
   */
  get destroyed() {
    return this._destroyed;
  }
  /**
   * Close the underlying database connection.
   * @deprecated Use {@link destroy} instead to also zero the master key.
   */
  close() {
    this.destroy();
  }
  /**
   * Zero the in-memory master key and close the database.
   *
   * After calling this method the Vault instance is no longer usable —
   * any attempt to encrypt or decrypt will fail because the key material
   * has been overwritten with zeroes.
   *
   * Idempotent: calling destroy() more than once is safe.
   */
  destroy() {
    if (!this._destroyed) {
      this.masterKey.fill(0);
      this._destroyed = true;
    }
    this.db.close();
  }
};

// src/transformers/inbound/openai-chat.ts
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}
function mapContent(raw) {
  if (typeof raw === "string") return raw;
  if (raw === null || raw === void 0) return void 0;
  if (Array.isArray(raw)) {
    return raw.map((part) => {
      if (!isObject(part)) {
        throw new TransformError("Invalid content part \u2014 expected object", "openai-chat");
      }
      if (part["type"] === "text" && typeof part["text"] === "string") {
        return { type: "text", text: part["text"] };
      }
      if (part["type"] === "image_url" && isObject(part["image_url"])) {
        const img = part["image_url"];
        return {
          type: "image_url",
          image_url: {
            url: img["url"],
            ...typeof img["detail"] === "string" ? { detail: img["detail"] } : {}
          }
        };
      }
      throw new TransformError(`Unsupported content part type: ${String(part["type"])}`, "openai-chat");
    });
  }
  throw new TransformError("content must be string, array, or null", "openai-chat");
}
function mapToolCalls(raw) {
  if (!Array.isArray(raw)) return void 0;
  return raw.map((tc) => {
    if (!isObject(tc) || !isObject(tc["function"])) {
      throw new TransformError("Invalid tool call", "openai-chat");
    }
    const fn = tc["function"];
    return {
      id: String(tc["id"] ?? ""),
      type: "function",
      function: {
        name: String(fn["name"] ?? ""),
        arguments: String(fn["arguments"] ?? "")
      }
    };
  });
}
function mapTools(raw) {
  if (!Array.isArray(raw)) return void 0;
  return raw.map((tool) => {
    if (!isObject(tool) || !isObject(tool["function"])) {
      throw new TransformError("Invalid tool definition", "openai-chat");
    }
    const fn = tool["function"];
    return {
      type: "function",
      function: {
        name: String(fn["name"] ?? ""),
        ...typeof fn["description"] === "string" ? { description: fn["description"] } : {},
        ...isObject(fn["parameters"]) ? { parameters: fn["parameters"] } : {}
      }
    };
  });
}
function mapToolChoice(raw) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw === "string") {
    if (raw === "none" || raw === "auto" || raw === "required") return raw;
    return void 0;
  }
  if (isObject(raw) && raw["type"] === "function" && isObject(raw["function"])) {
    const fn = raw["function"];
    return {
      type: "function",
      function: { name: String(fn["name"] ?? "") }
    };
  }
  return void 0;
}
function mapMessage(raw) {
  if (!isObject(raw)) {
    throw new TransformError("Invalid message \u2014 expected object", "openai-chat");
  }
  const role = raw["role"];
  if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") {
    throw new TransformError(`Unsupported message role: ${String(role)}`, "openai-chat");
  }
  const msg = {
    role,
    content: mapContent(raw["content"])
  };
  const toolCalls = mapToolCalls(raw["tool_calls"]);
  if (toolCalls) {
    msg.toolCalls = toolCalls;
  }
  if (typeof raw["tool_call_id"] === "string") {
    msg.toolCallId = raw["tool_call_id"];
  }
  return msg;
}
var openaiChatInbound = {
  name: "openai-chat",
  detect(request) {
    if (!isObject(request)) return false;
    return Array.isArray(request["messages"]) && typeof request["model"] === "string";
  },
  transformRequest(raw) {
    if (!isObject(raw)) {
      throw new TransformError("Request must be an object", "openai-chat");
    }
    const rawMessages = raw["messages"];
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      throw new TransformError("messages must be a non-empty array", "openai-chat");
    }
    const messages = rawMessages.map(mapMessage);
    const request = { messages };
    if (typeof raw["model"] === "string") {
      request.model = raw["model"];
    }
    if (typeof raw["temperature"] === "number") {
      request.temperature = raw["temperature"];
    }
    if (typeof raw["max_tokens"] === "number") {
      request.maxTokens = raw["max_tokens"];
    }
    if (typeof raw["top_p"] === "number") {
      request.topP = raw["top_p"];
    }
    if (typeof raw["stop"] === "string" || isStringArray(raw["stop"])) {
      request.stop = raw["stop"];
    }
    const tools = mapTools(raw["tools"]);
    if (tools) {
      request.tools = tools;
    }
    const toolChoice = mapToolChoice(raw["tool_choice"]);
    if (toolChoice !== void 0) {
      request.toolChoice = toolChoice;
    }
    return request;
  }
};

// src/transformers/inbound/openai-responses.ts
function isObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function mapInputItem(item) {
  if (!isObject2(item)) {
    throw new TransformError("Invalid input item \u2014 expected object", "openai-responses");
  }
  const role = item["role"];
  if (role !== "system" && role !== "user" && role !== "assistant") {
    throw new TransformError(`Unsupported input item role: ${String(role)}`, "openai-responses");
  }
  const content = mapInputContent(item["content"]);
  return { role, content };
}
function mapInputContent(raw) {
  if (typeof raw === "string") return raw;
  if (raw === null || raw === void 0) return void 0;
  if (Array.isArray(raw)) {
    return raw.map((part) => {
      if (!isObject2(part)) {
        throw new TransformError("Invalid content part \u2014 expected object", "openai-responses");
      }
      if (part["type"] === "input_text" && typeof part["text"] === "string") {
        return { type: "text", text: part["text"] };
      }
      if (part["type"] === "text" && typeof part["text"] === "string") {
        return { type: "text", text: part["text"] };
      }
      if (part["type"] === "input_image" && isObject2(part["image_url"])) {
        const img = part["image_url"];
        return {
          type: "image_url",
          image_url: {
            url: img["url"],
            ...typeof img["detail"] === "string" ? { detail: img["detail"] } : {}
          }
        };
      }
      throw new TransformError(
        `Unsupported content part type: ${String(part["type"])}`,
        "openai-responses"
      );
    });
  }
  throw new TransformError("content must be string, array, or null", "openai-responses");
}
function mapTools2(raw) {
  if (!Array.isArray(raw)) return void 0;
  return raw.map((tool) => {
    if (!isObject2(tool)) {
      throw new TransformError("Invalid tool definition", "openai-responses");
    }
    if (tool["type"] === "function") {
      const fn = isObject2(tool["function"]) ? tool["function"] : tool;
      return {
        type: "function",
        function: {
          name: String(fn["name"] ?? ""),
          ...typeof fn["description"] === "string" ? { description: fn["description"] } : {},
          ...isObject2(fn["parameters"]) ? { parameters: fn["parameters"] } : {}
        }
      };
    }
    throw new TransformError(`Unsupported tool type: ${String(tool["type"])}`, "openai-responses");
  });
}
function mapToolChoice2(raw) {
  if (raw === void 0 || raw === null) return void 0;
  if (typeof raw === "string") {
    if (raw === "none" || raw === "auto" || raw === "required") return raw;
    return void 0;
  }
  if (isObject2(raw) && raw["type"] === "function" && isObject2(raw["function"])) {
    const fn = raw["function"];
    return {
      type: "function",
      function: { name: String(fn["name"] ?? "") }
    };
  }
  return void 0;
}
function inputToMessages(input) {
  if (typeof input === "string") {
    return [{ role: "user", content: input }];
  }
  if (Array.isArray(input)) {
    if (input.length === 0) {
      throw new TransformError("input array must not be empty", "openai-responses");
    }
    return input.map(mapInputItem);
  }
  throw new TransformError("input must be a string or array", "openai-responses");
}
var openaiResponsesInbound = {
  name: "openai-responses",
  detect(request) {
    if (!isObject2(request)) return false;
    const hasInput = typeof request["input"] === "string" || Array.isArray(request["input"]);
    const hasModel = typeof request["model"] === "string";
    const hasMessages = "messages" in request;
    return hasInput && hasModel && !hasMessages;
  },
  transformRequest(raw) {
    if (!isObject2(raw)) {
      throw new TransformError("Request must be an object", "openai-responses");
    }
    const input = raw["input"];
    if (input === void 0 || input === null) {
      throw new TransformError("input is required", "openai-responses");
    }
    const messages = inputToMessages(input);
    if (typeof raw["instructions"] === "string") {
      messages.unshift({ role: "system", content: raw["instructions"] });
    }
    const request = { messages };
    if (typeof raw["model"] === "string") {
      request.model = raw["model"];
    }
    if (typeof raw["temperature"] === "number") {
      request.temperature = raw["temperature"];
    }
    if (typeof raw["max_output_tokens"] === "number") {
      request.maxTokens = raw["max_output_tokens"];
    }
    if (typeof raw["top_p"] === "number") {
      request.topP = raw["top_p"];
    }
    const tools = mapTools2(raw["tools"]);
    if (tools) {
      request.tools = tools;
    }
    const toolChoice = mapToolChoice2(raw["tool_choice"]);
    if (toolChoice !== void 0) {
      request.toolChoice = toolChoice;
    }
    return request;
  }
};

// src/transformers/inbound/anthropic.ts
function isObject3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function mapContent2(raw) {
  if (typeof raw === "string") return raw;
  if (raw === null || raw === void 0) return void 0;
  if (Array.isArray(raw)) {
    return raw.map((part) => {
      if (!isObject3(part)) {
        throw new TransformError("Invalid content block \u2014 expected object", "anthropic");
      }
      if (part["type"] === "text" && typeof part["text"] === "string") {
        return { type: "text", text: part["text"] };
      }
      if (part["type"] === "image" && isObject3(part["source"])) {
        const src = part["source"];
        if (src["type"] === "base64" && typeof src["data"] === "string") {
          const mediaType = typeof src["media_type"] === "string" ? src["media_type"] : "image/png";
          return {
            type: "image_url",
            image_url: {
              url: `data:${mediaType};base64,${src["data"]}`
            }
          };
        }
        if (src["type"] === "url" && typeof src["url"] === "string") {
          return {
            type: "image_url",
            image_url: { url: src["url"] }
          };
        }
        throw new TransformError("Unsupported image source type", "anthropic");
      }
      if (part["type"] === "tool_use") {
        return null;
      }
      if (part["type"] === "tool_result") {
        return null;
      }
      throw new TransformError(
        `Unsupported content block type: ${String(part["type"])}`,
        "anthropic"
      );
    }).filter((p) => p !== null);
  }
  throw new TransformError("content must be string, array, or null", "anthropic");
}
function mapToolUseBlocks(content) {
  if (!Array.isArray(content)) return void 0;
  const toolCalls = [];
  for (const block of content) {
    if (isObject3(block) && block["type"] === "tool_use") {
      toolCalls.push({
        id: String(block["id"] ?? ""),
        type: "function",
        function: {
          name: String(block["name"] ?? ""),
          arguments: typeof block["input"] === "string" ? block["input"] : JSON.stringify(block["input"] ?? {})
        }
      });
    }
  }
  return toolCalls.length > 0 ? toolCalls : void 0;
}
function mapTools3(raw) {
  if (!Array.isArray(raw)) return void 0;
  return raw.map((tool) => {
    if (!isObject3(tool)) {
      throw new TransformError("Invalid tool definition", "anthropic");
    }
    return {
      type: "function",
      function: {
        name: String(tool["name"] ?? ""),
        ...typeof tool["description"] === "string" ? { description: tool["description"] } : {},
        ...isObject3(tool["input_schema"]) ? { parameters: tool["input_schema"] } : {}
      }
    };
  });
}
function mapToolChoice3(raw) {
  if (raw === void 0 || raw === null) return void 0;
  if (isObject3(raw)) {
    const type = raw["type"];
    if (type === "auto") return "auto";
    if (type === "any") return "required";
    if (type === "none") return "none";
    if (type === "tool" && typeof raw["name"] === "string") {
      return {
        type: "function",
        function: { name: raw["name"] }
      };
    }
  }
  return void 0;
}
function mapMessage2(raw) {
  if (!isObject3(raw)) {
    throw new TransformError("Invalid message \u2014 expected object", "anthropic");
  }
  const role = raw["role"];
  if (role !== "user" && role !== "assistant") {
    throw new TransformError(
      `Unsupported message role: ${String(role)}. Anthropic uses top-level 'system' field.`,
      "anthropic"
    );
  }
  if (role === "user" && Array.isArray(raw["content"])) {
    const blocks = raw["content"];
    const isToolResult = blocks.some(
      (b) => isObject3(b) && b["type"] === "tool_result"
    );
    if (isToolResult) {
      const toolBlock = blocks.find(
        (b) => isObject3(b) && b["type"] === "tool_result"
      );
      const resultContent = typeof toolBlock["content"] === "string" ? toolBlock["content"] : JSON.stringify(toolBlock["content"] ?? "");
      return {
        role: "tool",
        content: resultContent,
        toolCallId: String(toolBlock["tool_use_id"] ?? "")
      };
    }
  }
  const content = mapContent2(raw["content"]);
  const msg = { role, content };
  if (role === "assistant" && Array.isArray(raw["content"])) {
    const toolCalls = mapToolUseBlocks(raw["content"]);
    if (toolCalls) {
      msg.toolCalls = toolCalls;
    }
  }
  return msg;
}
var anthropicInbound = {
  name: "anthropic",
  detect(request) {
    if (!isObject3(request)) return false;
    return Array.isArray(request["messages"]) && typeof request["max_tokens"] === "number";
  },
  transformRequest(raw) {
    if (!isObject3(raw)) {
      throw new TransformError("Request must be an object", "anthropic");
    }
    const rawMessages = raw["messages"];
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      throw new TransformError("messages must be a non-empty array", "anthropic");
    }
    const messages = [];
    if (typeof raw["system"] === "string") {
      messages.push({ role: "system", content: raw["system"] });
    }
    if (Array.isArray(raw["system"])) {
      const systemContent = mapContent2(raw["system"]);
      messages.push({ role: "system", content: systemContent });
    }
    for (const msg of rawMessages) {
      messages.push(mapMessage2(msg));
    }
    const request = { messages };
    if (typeof raw["model"] === "string") {
      request.model = raw["model"];
    }
    if (typeof raw["max_tokens"] === "number") {
      request.maxTokens = raw["max_tokens"];
    }
    if (typeof raw["temperature"] === "number") {
      request.temperature = raw["temperature"];
    }
    if (typeof raw["top_p"] === "number") {
      request.topP = raw["top_p"];
    }
    if (Array.isArray(raw["stop_sequences"])) {
      request.stop = raw["stop_sequences"];
    }
    const tools = mapTools3(raw["tools"]);
    if (tools) {
      request.tools = tools;
    }
    const toolChoice = mapToolChoice3(raw["tool_choice"]);
    if (toolChoice !== void 0) {
      request.toolChoice = toolChoice;
    }
    return request;
  }
};

// src/transformers/outbound/openai.ts
function isObject4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function messageToOpenAI(msg) {
  const result = { role: msg.role };
  if (msg.content !== void 0) {
    if (typeof msg.content === "string") {
      result["content"] = msg.content;
    } else if (Array.isArray(msg.content)) {
      result["content"] = msg.content.map((part) => {
        if (part.type === "text") {
          return { type: "text", text: part.text };
        }
        return {
          type: "image_url",
          image_url: {
            url: part.image_url.url,
            ...part.image_url.detail ? { detail: part.image_url.detail } : {}
          }
        };
      });
    }
  } else {
    result["content"] = null;
  }
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    result["tool_calls"] = msg.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments
      }
    }));
  }
  if (msg.toolCallId) {
    result["tool_call_id"] = msg.toolCallId;
  }
  return result;
}
function mapFinishReason(reason) {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
      return "tool_calls";
    case "content_filter":
      return "content_filter";
    default:
      return "stop";
  }
}
var openaiOutbound = {
  name: "openai",
  transformRequest(internal) {
    const body = {
      messages: internal.messages.map(messageToOpenAI)
    };
    if (internal.model) body["model"] = internal.model;
    if (internal.temperature !== void 0) body["temperature"] = internal.temperature;
    if (internal.maxTokens !== void 0) body["max_tokens"] = internal.maxTokens;
    if (internal.topP !== void 0) body["top_p"] = internal.topP;
    if (internal.stop !== void 0) body["stop"] = internal.stop;
    if (internal.tools && internal.tools.length > 0) {
      body["tools"] = internal.tools.map((t) => ({
        type: "function",
        function: {
          name: t.function.name,
          ...t.function.description ? { description: t.function.description } : {},
          ...t.function.parameters ? { parameters: t.function.parameters } : {}
        }
      }));
    }
    if (internal.toolChoice !== void 0) {
      if (typeof internal.toolChoice === "string") {
        body["tool_choice"] = internal.toolChoice;
      } else {
        body["tool_choice"] = {
          type: "function",
          function: { name: internal.toolChoice.function.name }
        };
      }
    }
    return body;
  },
  transformResponse(providerResponse) {
    if (!isObject4(providerResponse)) {
      throw new TransformError("Response must be an object", "openai");
    }
    const choices = providerResponse["choices"];
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new TransformError("Response must have at least one choice", "openai");
    }
    const choice = choices[0];
    const message = choice["message"];
    const content = typeof message?.["content"] === "string" ? message["content"] : "";
    const usage = isObject4(providerResponse["usage"]) ? providerResponse["usage"] : {};
    const inputTokens = typeof usage["prompt_tokens"] === "number" ? usage["prompt_tokens"] : 0;
    const outputTokens = typeof usage["completion_tokens"] === "number" ? usage["completion_tokens"] : 0;
    const response = {
      content,
      model: typeof providerResponse["model"] === "string" ? providerResponse["model"] : "",
      finishReason: mapFinishReason(choice["finish_reason"]),
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      }
    };
    if (message && Array.isArray(message["tool_calls"])) {
      response.toolCalls = message["tool_calls"].map((tc) => {
        const fn = tc["function"];
        return {
          id: String(tc["id"] ?? ""),
          type: "function",
          function: {
            name: String(fn["name"] ?? ""),
            arguments: String(fn["arguments"] ?? "")
          }
        };
      });
    }
    return response;
  }
};

// src/transformers/outbound/anthropic.ts
function isObject5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function messageToAnthropic(msg) {
  if (msg.role === "system") return null;
  if (msg.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: msg.toolCallId ?? "",
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "")
        }
      ]
    };
  }
  const result = { role: msg.role };
  const contentBlocks = [];
  if (msg.content !== void 0) {
    if (typeof msg.content === "string") {
      contentBlocks.push({ type: "text", text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text") {
          contentBlocks.push({ type: "text", text: part.text });
        } else if (part.type === "image_url") {
          const url = part.image_url.url;
          if (url.startsWith("data:")) {
            const match = /^data:([^;]+);base64,(.+)$/.exec(url);
            if (match) {
              contentBlocks.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: match[1],
                  data: match[2]
                }
              });
            }
          } else {
            contentBlocks.push({
              type: "image",
              source: { type: "url", url }
            });
          }
        }
      }
    }
  }
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    for (const tc of msg.toolCalls) {
      let input;
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        input = tc.function.arguments;
      }
      contentBlocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input
      });
    }
  }
  if (contentBlocks.length === 1 && contentBlocks[0]?.["type"] === "text") {
    result["content"] = contentBlocks[0]["text"];
  } else if (contentBlocks.length > 0) {
    result["content"] = contentBlocks;
  }
  return result;
}
function extractSystemMessage(messages) {
  const systemMsgs = messages.filter((m) => m.role === "system");
  if (systemMsgs.length === 0) return void 0;
  return systemMsgs.map((m) => {
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
    }
    return "";
  }).join("\n");
}
function mapStopReason(reason) {
  switch (reason) {
    case "end_turn":
      return "stop";
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return "stop";
  }
}
var anthropicOutbound = {
  name: "anthropic",
  transformRequest(internal) {
    const body = {};
    if (internal.model) body["model"] = internal.model;
    body["max_tokens"] = internal.maxTokens ?? 4096;
    const system = extractSystemMessage(internal.messages);
    if (system) body["system"] = system;
    const messages = internal.messages.map(messageToAnthropic).filter((m) => m !== null);
    body["messages"] = messages;
    if (internal.temperature !== void 0) body["temperature"] = internal.temperature;
    if (internal.topP !== void 0) body["top_p"] = internal.topP;
    if (internal.stop) body["stop_sequences"] = Array.isArray(internal.stop) ? internal.stop : [internal.stop];
    if (internal.tools && internal.tools.length > 0) {
      body["tools"] = internal.tools.map((t) => ({
        name: t.function.name,
        ...t.function.description ? { description: t.function.description } : {},
        ...t.function.parameters ? { input_schema: t.function.parameters } : {}
      }));
    }
    if (internal.toolChoice !== void 0) {
      if (typeof internal.toolChoice === "string") {
        switch (internal.toolChoice) {
          case "auto":
            body["tool_choice"] = { type: "auto" };
            break;
          case "required":
            body["tool_choice"] = { type: "any" };
            break;
          case "none":
            body["tool_choice"] = { type: "none" };
            break;
        }
      } else {
        body["tool_choice"] = { type: "tool", name: internal.toolChoice.function.name };
      }
    }
    return body;
  },
  transformResponse(providerResponse) {
    if (!isObject5(providerResponse)) {
      throw new TransformError("Response must be an object", "anthropic");
    }
    const contentBlocks = providerResponse["content"];
    let content = "";
    if (Array.isArray(contentBlocks)) {
      content = contentBlocks.filter((b) => isObject5(b) && b["type"] === "text").map((b) => b["text"]).join("");
    }
    const usage = isObject5(providerResponse["usage"]) ? providerResponse["usage"] : {};
    const inputTokens = typeof usage["input_tokens"] === "number" ? usage["input_tokens"] : 0;
    const outputTokens = typeof usage["output_tokens"] === "number" ? usage["output_tokens"] : 0;
    const response = {
      content,
      model: typeof providerResponse["model"] === "string" ? providerResponse["model"] : "",
      finishReason: mapStopReason(providerResponse["stop_reason"]),
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      }
    };
    if (Array.isArray(contentBlocks)) {
      const toolCalls = contentBlocks.filter((b) => isObject5(b) && b["type"] === "tool_use").map((b) => {
        const block = b;
        return {
          id: String(block["id"] ?? ""),
          type: "function",
          function: {
            name: String(block["name"] ?? ""),
            arguments: typeof block["input"] === "string" ? block["input"] : JSON.stringify(block["input"] ?? {})
          }
        };
      });
      if (toolCalls.length > 0) {
        response.toolCalls = toolCalls;
      }
    }
    return response;
  }
};

// src/transformers/outbound/google.ts
var googleOutbound = {
  name: "google",
  transformRequest(internal) {
    return openaiOutbound.transformRequest(internal);
  },
  transformResponse(providerResponse) {
    return openaiOutbound.transformResponse(providerResponse);
  }
};

// src/transformers/outbound/cli.ts
function isObject6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function flattenMessages(messages) {
  const systemParts = [];
  const conversationParts = [];
  for (const msg of messages) {
    const text = typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.filter((p) => p.type === "text").map((p) => p.text).join("\n") : "";
    if (!text) continue;
    if (msg.role === "system") {
      systemParts.push(text);
    } else {
      conversationParts.push(text);
    }
  }
  const system = systemParts.length > 0 ? systemParts.join("\n") : void 0;
  const prompt = conversationParts.length > 0 ? conversationParts.join("\n") : system ?? "";
  return { prompt, system };
}
var cliOutbound = {
  name: "cli",
  transformRequest(internal) {
    if (!internal.messages || internal.messages.length === 0) {
      throw new TransformError("At least one message is required", "cli");
    }
    const { prompt, system } = flattenMessages(internal.messages);
    const result = {
      prompt
    };
    if (system) result["system"] = system;
    if (internal.model) result["model"] = internal.model;
    if (internal.maxTokens !== void 0) result["maxTokens"] = internal.maxTokens;
    if (internal.temperature !== void 0) result["temperature"] = internal.temperature;
    return result;
  },
  transformResponse(providerResponse) {
    let content;
    if (typeof providerResponse === "string") {
      content = providerResponse;
    } else if (isObject6(providerResponse)) {
      const text = providerResponse["text"];
      if (typeof text === "string") {
        content = text;
      } else {
        throw new TransformError('CLI response object must have a "text" field', "cli");
      }
    } else {
      throw new TransformError("CLI response must be a string or object with text", "cli");
    }
    const model = isObject6(providerResponse) && typeof providerResponse["model"] === "string" ? providerResponse["model"] : "cli-unknown";
    return {
      content,
      model,
      finishReason: "stop",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      }
    };
  }
};

// src/transformers/outbound/openai-stream.ts
function parseOpenAIChunk(raw) {
  const chunk = raw;
  const choices = chunk["choices"];
  const choice = choices?.[0];
  const delta = choice?.["delta"];
  const finishReason = choice?.["finish_reason"];
  const content = typeof delta?.["content"] === "string" ? delta["content"] : "";
  const done = finishReason !== null && finishReason !== void 0;
  const result = { content, done };
  if (typeof chunk["model"] === "string") {
    result.model = chunk["model"];
  }
  if (done && finishReason) {
    result.finishReason = mapFinishReason2(finishReason);
  }
  const usage = chunk["usage"];
  if (usage) {
    if (typeof usage["prompt_tokens"] === "number") result.tokensIn = usage["prompt_tokens"];
    if (typeof usage["completion_tokens"] === "number") result.tokensOut = usage["completion_tokens"];
  }
  return result;
}
function mapFinishReason2(reason) {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
      return "tool_calls";
    case "content_filter":
      return "content_filter";
    default:
      return "stop";
  }
}
function createOpenAIStreamTransformer(providerName) {
  return {
    name: providerName,
    async *transformStream(internal, providerCall) {
      const requestBody = openaiOutbound.transformRequest(internal);
      requestBody["stream"] = true;
      requestBody["stream_options"] = { include_usage: true };
      const stream = providerCall(requestBody);
      for await (const rawChunk of stream) {
        const chunk = parseOpenAIChunk(rawChunk);
        yield chunk;
      }
    }
  };
}
var openaiStreamTransformer = createOpenAIStreamTransformer("openai");
var groqStreamTransformer = createOpenAIStreamTransformer("groq");
var openrouterStreamTransformer = createOpenAIStreamTransformer("openrouter");
var googleStreamTransformer = createOpenAIStreamTransformer("google");

// src/transformers/outbound/anthropic-stream.ts
function mapStopReason2(reason) {
  switch (reason) {
    case "end_turn":
      return "stop";
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return "stop";
  }
}
var anthropicStreamTransformer = {
  name: "anthropic",
  async *transformStream(internal, providerCall) {
    const requestBody = anthropicOutbound.transformRequest(internal);
    requestBody["stream"] = true;
    const stream = providerCall(requestBody);
    let model;
    let tokensIn;
    let tokensOut;
    for await (const event of stream) {
      const evt = event;
      const type = evt["type"];
      switch (type) {
        case "message_start": {
          const message = evt["message"];
          if (message) {
            model = typeof message["model"] === "string" ? message["model"] : void 0;
            const usage = message["usage"];
            if (typeof usage?.["input_tokens"] === "number") {
              tokensIn = usage["input_tokens"];
            }
          }
          break;
        }
        case "content_block_delta": {
          const delta = evt["delta"];
          if (delta?.["type"] === "text_delta" && typeof delta["text"] === "string") {
            yield {
              content: delta["text"],
              done: false,
              model
            };
          }
          break;
        }
        case "message_delta": {
          const delta = evt["delta"];
          const usage = evt["usage"];
          if (typeof usage?.["output_tokens"] === "number") {
            tokensOut = usage["output_tokens"];
          }
          const stopReason = delta?.["stop_reason"];
          yield {
            content: "",
            done: true,
            model,
            finishReason: mapStopReason2(stopReason),
            tokensIn,
            tokensOut
          };
          break;
        }
        // Other event types (content_block_start, content_block_stop, message_stop)
        // don't carry content we need to forward.
        default:
          break;
      }
    }
  }
};

// src/transformers/index.ts
registry.registerInbound(anthropicInbound);
registry.registerInbound(openaiResponsesInbound);
registry.registerInbound(openaiChatInbound);
registry.registerOutbound("openai", openaiOutbound);
registry.registerOutbound("anthropic", anthropicOutbound);
registry.registerOutbound("google", googleOutbound);
registry.registerOutbound("groq", openaiOutbound);
registry.registerOutbound("openrouter", openaiOutbound);
registry.registerOutbound("cli", cliOutbound);
registry.registerOutbound("claude-cli", cliOutbound);
registry.registerOutbound("codex-cli", cliOutbound);
registry.registerOutbound("gemini-cli", cliOutbound);
registry.registerOutbound("copilot-cli", cliOutbound);
registry.registerStreamOutbound("openai", openaiStreamTransformer);
registry.registerStreamOutbound("anthropic", anthropicStreamTransformer);
registry.registerStreamOutbound("google", googleStreamTransformer);
registry.registerStreamOutbound("groq", groqStreamTransformer);
registry.registerStreamOutbound("openrouter", openrouterStreamTransformer);

// src/index.ts
initTracing();
initMetrics();
var mode = process.argv[2];
var config = loadConfig();
var vault = new Vault(config);
var router = new Router();
for (const adapter of createAllAdapters(vault)) {
  router.register(adapter);
}
var costTracker = new CostTracker({ dbPath: config.dbPath });
router.setCostTracker(costTracker);
router.setTransformerRegistry(registry);
var groupStore = new GroupStore(config.dbPath);
router.setGroupStore(groupStore);
var sessionStore = new SessionStore();
router.setSessionStore(sessionStore);
var compressor = new CompressorService();
var codeSearch = new CodeSearchService();
var stateManager = new StateManager();
var freeModelEnabled = process.env["FALLBACK_STRATEGY"] === "free-models";
var freeModelRouter = new FreeModelRouter({ enabled: freeModelEnabled });
if (freeModelEnabled) {
  router.setFreeModelRouter(freeModelRouter);
  logger.info("Free model fallback routing enabled");
}
var catalogEnabled = process.env["FREE_MODEL_CATALOG"] === "true";
if (catalogEnabled) {
  const catalog = loadCatalog();
  if (catalog) {
    const entries = importCatalog(catalog, freeModelRouter.getHealthChecker());
    const imported = freeModelRouter.getRegistry().importModels(entries);
    logger.info({ imported }, "Free model catalog loaded at startup");
  }
}
var latencyRoutingEnabled = process.env["LATENCY_ROUTING"] === "true";
var latencyMeasurer = new LatencyMeasurer();
if (latencyRoutingEnabled) {
  router.setLatencyMeasurer(latencyMeasurer);
  logger.info("Latency-based routing enabled");
}
var bridgeConfig = loadBridgeConfig();
var bridge = bridgeConfig ? new BridgeOrchestrator(router, bridgeConfig) : null;
if (bridge) {
  logger.info("Bridge orchestrator enabled \u2014 task-aware routing active");
}
async function setupGracefulShutdown(vault2) {
  const cleanup = async (signal) => {
    logger.info({ signal }, "Shutting down");
    compressor.destroy();
    latencyMeasurer.stopBackgroundTask();
    freeModelRouter.destroy();
    costTracker.destroy();
    groupStore.close();
    sessionStore.destroy();
    cleanupAllProviderHomes();
    vault2.destroy();
    await shutdownTracing();
    process.exit(0);
  };
  process.on("SIGINT", () => cleanup("SIGINT"));
  process.on("SIGTERM", () => cleanup("SIGTERM"));
}
await setupGracefulShutdown(vault);
var db = vault.getDb();
var maxComparisonCostUsd = parseFloat(
  process.env["MAX_COMPARISON_COST_USD"] ?? "1.0"
);
var comparisonStore = new ComparisonStore(db);
var comparisonService = new ComparisonService(router, {
  freeModelRegistry: freeModelEnabled ? freeModelRouter.getRegistry() : void 0,
  store: comparisonStore,
  maxCostCeiling: maxComparisonCostUsd
});
if (mode === "serve") {
  startHttpServer(
    router,
    vault,
    config,
    groupStore,
    costTracker,
    latencyMeasurer,
    freeModelRouter,
    db,
    comparisonService
  );
} else {
  await startMcpServer(
    router,
    vault,
    void 0,
    costTracker,
    bridge,
    codeSearch,
    stateManager,
    config.securityProfile
  );
  if (mode === "--http") {
    startHttpServer(
      router,
      vault,
      config,
      groupStore,
      costTracker,
      latencyMeasurer,
      freeModelRouter,
      db,
      comparisonService
    );
  }
}
