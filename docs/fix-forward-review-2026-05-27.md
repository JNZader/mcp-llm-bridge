# Fix-Forward Review — 2026-05-27

> Review of commits:
> - `8582ae0` — feat: wire all orphaned modules
> - `9ca8061` — fix(tests): update security-profiles tool count
> - `0c109c4` — feat(price-sync): wire price manager

## Verdict

Huge progress, but **not everything is production-safe yet**.

### Safe / mostly good
- `price-sync`
- DB migrations at bootstrap
- `pageindex` base wiring
- analytics base wiring
- logging base wiring
- sandbox flag in security profiles
- tool catalog HTTP surface
- circuit-breaker v2 streaming fix

### Not ready to call fully done
- **dynamic MCP plugin loading**
- **model routing runtime behavior**
- **session dashboard coherence**
- **analytics channel/model serialization**
- **streaming request logging**

---

## Critical Issues

### 1. Dynamic MCP plugin loading breaks with default path
- **Severity:** Critical
- **Files:** `src/mcp-builder/loader.ts`, `src/server/mcp.ts`
- **Problem:** `import(join(pluginsDir, file))` can produce a bare specifier like `mcp-servers/example.mcp-server.js` instead of a proper file URL / relative import.
- **Impact:** `MCP_DYNAMIC_SERVERS=true` with default config may fail to load plugins at runtime.
- **Fix idea:** Resolve to absolute path and convert with `pathToFileURL()` before dynamic import.

### 2. Model routing is mostly a no-op in real configs
- **Severity:** Critical
- **Files:** `src/core/router.ts`, `src/model-routing/config.ts`, `src/model-routing/types.ts`, `model-routing.json`
- **Problem:** Routing decisions use endpoint IDs, but runtime compares against provider IDs. Also, selected endpoint model is not injected into the actual request.
- **Impact:** ModelRouter can “decide” an endpoint but runtime silently falls back to old ordering, or uses the wrong model.
- **Fix idea:**
  1. Map endpoint -> provider explicitly
  2. Carry selected `modelId` into request resolution
  3. Add integration test where `endpoint.id !== provider.id`

---

## Medium Issues

### 3. `/admin/sessions` reports from a different session system than routing
- **Severity:** Medium
- **Files:** `src/index.ts`, `src/server/admin.ts`
- **Problem:** Admin dashboard uses `SessionManager`, while router still uses `SessionStore`.
- **Impact:** Dashboard can show misleading or empty data even when sticky routing is active.
- **Fix idea:** Either unify session systems, or clearly mark endpoint as GroupManager-only sessions.

### 4. `/v1/analytics?dimension=channel|model` loses labels
- **Severity:** Medium
- **Files:** `src/analytics/aggregator.ts`, `src/analytics/types.ts`
- **Problem:** Aggregated output does not reliably include channel/model identifiers.
- **Impact:** Endpoint is much less useful for dashboards.
- **Fix idea:** Ensure serialized output carries `channelId` or `model` label per row.

### 5. Streaming request logs are incomplete
- **Severity:** Medium
- **Files:** `src/server/http.ts`
- **Problem:** Real SSE/streaming flow does not consistently call `requestLogger.captureEnd(...)`.
- **Impact:** `/v1/logs` underreports important traffic.
- **Fix idea:** Add logging completion hooks for the real streaming path, not only fallback branches.

### 6. `model-sync/history` accepts invalid provider query too softly
- **Severity:** Low/Medium
- **Files:** `src/server/admin.ts`
- **Problem:** Invalid provider query can fall back to broad results instead of hard failure.
- **Impact:** Bad operator UX / hidden mistakes.
- **Fix idea:** Validate and return 400 for unsupported providers.

---

## Architecture / Code Smells

### 7. `http.ts` is now a god module
- **Severity:** Medium
- **Files:** `src/server/http.ts`
- **Problem:** Too many responsibilities in one file (analytics, logs, protocol conversion, catalog, balancer, admin plumbing, etc.).
- **Fix idea:** Split into route modules (`routes/generate.ts`, `routes/chat.ts`, `routes/analytics.ts`, `routes/logs.ts`, etc.).

### 8. Positional dependency injection is brittle
- **Severity:** Medium
- **Files:** `src/server/http.ts`, `src/index.ts`
- **Problem:** `startHttpServer(...)` now takes too many ordered arguments.
- **Fix idea:** Move to an options object `{ router, vault, analyticsAggregator, requestLogger, ... }`.

### 9. Tool catalog may be “fake wired”
- **Severity:** Medium
- **Files:** `src/server/http.ts`, `src/tool-catalog/index.ts`
- **Problem:** Endpoints exist, but if the catalog is not fed from the real tool registry, results may be incomplete or empty.
- **Fix idea:** Derive catalog data from the MCP/HTTP tool registry instead of manual population.

### 10. Security/tool metadata is still duplicated
- **Severity:** Medium
- **Files:** `src/security/profiles.ts`, `src/server/mcp.ts`, tests
- **Problem:** Tool list and tool categories are still maintained manually in multiple places.
- **Fix idea:** Generate / derive security categorization from a shared registry.

---

## Test / Reliability Gaps

### Well tested
- `price-sync` core logic
- model-sync admin path
- sandbox profile defaults
- pageindex core behavior
- mcp-builder unit behavior

### Under-tested or misleading
1. No deep HTTP test for `POST /v1/admin/prices/sync`
2. Dynamic MCP plugin loading not tested with default path resolution
3. Model routing not tested for endpoint/provider mismatch and model override
4. Analytics channel/model output not tested deeply
5. Streaming logging path not covered enough
6. `TOOL_CATEGORIES` hardcoded count assertion is brittle

---

## Priority Fix-Forward Plan

### Fix now
1. **mcp-builder loader path resolution**
2. **model-routing endpoint/provider/model mapping**
3. **analytics labels for channel/model dimensions**
4. **streaming log completion path**
5. **session dashboard disclaimer or temporary guard**

### Fix next
6. derive tool catalog from real registry
7. split `http.ts`
8. remove hardcoded tool counts in tests
9. harden model-sync / price-sync admin validation

---

## Suggested Next Session

If we continue tomorrow, the best sequence is:

1. Fix `mcp-builder` plugin path loading
2. Fix real runtime model routing
3. Fix analytics labels + streaming logging
4. Re-run targeted regression

That would turn the biggest “looks wired but isn't fully real” areas into production-safe features.
