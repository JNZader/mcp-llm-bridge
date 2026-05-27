# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] — Wiring Sprint

### Added

- **Security Profiles** — Trust-level-based access control for MCP tools and HTTP endpoints. Three built-in profiles: `local-dev` (all access), `restricted` (read + generate only), `open` (generate only). Configurable via `LLM_GATEWAY_SECURITY_PROFILE`.
- **Approval Flows** — Pause/resume pattern for destructive MCP tools when profile is not `local-dev`. Includes HTTP management endpoints (`GET /v1/approvals`, `POST /v1/approvals/:id/approve|deny`) and MCP tools (`approval_list`, `approval_approve`, `approval_deny`).
- **Three-Part Prompt** — System/context/instruction separation for improved LLM comprehension. Supported in `/v1/generate`, `/v1/chat/completions`, and `llm_generate` MCP tool. Flat prompts are auto-detected and split heuristically. Enabled by `OPTIMIZE_MESSAGES_ENABLED` (default: `true`).
- **RTK Output Compression** — Strips redundant fields, groups repeated entries, truncates long values, and deduplicates arrays from tool call results. Enabled by `ENABLE_OUTPUT_COMPRESSION` (default: `true`). Analytics exposed at `GET /v1/compression/stats`.
- **Local LLM Offloading** — Routes offloadable tasks to Ollama/LM Studio instead of cloud providers. Detects backends at startup. Falls back to cloud on failure. Enabled by `LOCAL_LLM_ENABLED` (default: `false`). MCP tool: `local_llm_generate`.
- **HF Auto-Discovery** — Scans local backends and enriches models with HuggingFace metadata at startup. Persists cache to SQLite. Triggered by `AUTO_DISCOVER_MODELS=true` (default: `false`). Admin endpoint: `POST /v1/admin/discover`.
- **Unified Classification Module** — Shared `TaskType` taxonomy and `ClassificationResult` interface used by bridge classifier, local-LLM router, and model-routing modules.
- **Integration Tests** — `test/integration/wiring-sprint.test.ts` exercises all wired features in sequence.
- **E2E Test** — `test/e2e/full-pipeline.test.ts` simulates a complete session across HTTP and MCP.

### Changed

- HTTP server accepts `securityProfile` and `approvalStore` parameters for profile enforcement and approval gating.
- MCP server wires `approvalStore` into `handleToolCall` for destructive tool gating.
- `/v1/generate` and `/v1/chat/completions` call `optimizeMessages()` when three-part fields are present.
- Router `generateFromInternal()` applies message optimization and catches `LocalLLMError` for fallback.
- Bootstrap (`src/index.ts`) instantiates `LocalLLMProvider`, `ApprovalStore`, and runs HF discovery when enabled.

### Fixed

- Renamed `requireApproveFor` typo to `requiresApprovalFor` in `ApprovalConfig`.
- Added missing HTTP route categories for `/v1/compression/stats` and `/v1/local/models`.

## [0.5.1] — Previous Release

- Encrypted LLM gateway and MCP server for routing API keys, CLI subscriptions, and model selection.
- 11 provider adapters (5 API + 6 CLI-backed).
- Vault with AES-256-GCM encryption.
- Bridge orchestrator for task-aware routing.
- Semantic code search and CRDT shared state.
