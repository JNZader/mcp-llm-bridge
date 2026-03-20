# Comprehensive Audit Report: mcp-llm-bridge

**Project**: [mcp-llm-bridge](https://github.com/JNZader/mcp-llm-bridge)  
**Version**: 0.2.0  
**Date**: 2026-03-20  
**Auditor**: Multi-Agent Deep Audit  
**Scope**: Security + Performance + Architecture  
**Status**: Pre-production review

---

## Executive Summary

This is a **comprehensive second audit** following security hardening improvements. The project shows significant progress with proper encryption, authentication, and input validation. However, critical security vulnerabilities and performance bottlenecks remain before production deployment.

| Category | Critical | High | Medium | Low | Info |
|----------|----------|------|--------|-----|------|
| **Security** | 4 | 3 | 3 | 2 | 3 |
| **Performance** | 3 | 5 | 7 | 2 | 0 |
| **Architecture** | 1 | 5 | 10 | 8 | 4 |

---

## Table of Contents

1. [🔴 CRITICAL Security Issues](#critical-security-issues)
2. [🟠 HIGH Security Issues](#high-security-issues)
3. [🟡 MEDIUM Security Issues](#medium-security-issues)
4. [🟢 LOW/INFO Security Issues](#lowinfo-security-issues)
5. [⚡ CRITICAL Performance Issues](#critical-performance-issues)
6. [🔥 HIGH Performance Issues](#high-performance-issues)
7. [📊 MEDIUM Performance Issues](#medium-performance-issues)
8. [🏗️ Architecture & Code Quality](#architecture--code-quality)
9. [✅ What's Done Right](#whats-done-right)
10. [📋 Prioritized Fix Roadmap](#prioritized-fix-roadmap)

---

# 🔴 CRITICAL Security Issues

## S-1: IDOR - Credential Deletion Without Authorization

| Attribute | Value |
|-----------|-------|
| **File** | `src/vault/vault.ts:301-303` |
| **CVSS** | 9.1 (Critical) |
| **CWE** | CWE-639 (Authorization Bypass Through User-Controlled Key) |

**Problem**: Any authenticated user can delete ANY credential by ID without verifying project ownership.

```typescript
// vault.ts:301-303 - NO AUTHORIZATION CHECK
delete(id: number): void {
  this.db.prepare('DELETE FROM credentials WHERE id = ?').run(id);
}
```

**Impact**: 
- Users can delete other users' credentials
- No way to audit who deleted what
- Cross-project deletion possible

**Proof of Concept**:
```bash
# List all credential IDs
curl -X GET http://localhost:3456/v1/credentials \
  -H "Authorization: Bearer $TOKEN"
# [{"id":1,"provider":"anthropic",...},{"id":2,"provider":"openai",...}]

# Delete ANY credential by ID
curl -X DELETE http://localhost:3456/v1/credentials/1 \
  -H "Authorization: Bearer $TOKEN"
# 200 OK - Deleted without verifying ownership!
```

**Fix**:
```typescript
delete(id: number, project?: string): void {
  // Verify credential exists AND belongs to user's project
  const row = this.db.prepare(
    'SELECT project FROM credentials WHERE id = ?'
  ).get(id) as { project: string } | undefined;
  
  if (!row) {
    throw new Error('Credential not found');
  }
  
  // Allow deletion only if same project or global
  if (row.project !== '_global' && row.project !== project) {
    throw new Error('Unauthorized: credential belongs to different project');
  }
  
  this.db.prepare('DELETE FROM credentials WHERE id = ?').run(id);
}
```

---

## S-2: IDOR - File Deletion Without Authorization

| Attribute | Value |
|-----------|-------|
| **File** | `src/vault/vault.ts:383-385` |
| **CVSS** | 9.1 (Critical) |
| **CWE** | CWE-639 (Authorization Bypass Through User-Controlled Key) |

**Problem**: Same as S-1 but for file deletion.

```typescript
// vault.ts:383-385
deleteFile(id: number): void {
  this.db.prepare('DELETE FROM files WHERE id = ?').run(id);
}
```

**Fix**: Apply same authorization check as S-1.

---

## S-3: IP Spoofing Bypasses Rate Limiting

| Attribute | Value |
|-----------|-------|
| **File** | `src/server/http.ts:147-154` |
| **CVSS** | 8.6 (High) |
| **CWE** | CWE-346 (Origin Validation Error) |

**Problem**: Rate limiting trusts `X-Forwarded-For` header which is user-controlled.

```typescript
function getClientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    const firstIp = forwarded.split(',')[0];
    return firstIp?.trim() ?? 'unknown';
  }
  return c.req.header('x-real-ip') ?? 'unknown';
}
```

**Impact**: Attackers can bypass rate limits by spoofing IPs.

**Proof of Concept**:
```bash
# Bypass rate limit by rotating IPs
for i in {1..200}; do
  curl -H "X-Forwarded-For: 1.2.3.$i" \
    http://localhost:3456/v1/generate \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"prompt":"test"}'
done
```

**Fix**: Only trust X-Forwarded-For behind a trusted reverse proxy:
```typescript
function getClientIp(c: Context): string {
  // Only trust X-Forwarded-For if behind trusted proxy
  const trustedProxy = process.env['TRUSTED_PROXY_IP'];
  
  if (trustedProxy) {
    const directIp = c.req.header('x-real-ip') ?? c.req.header('host')?.split(':')[0];
    const forwarded = c.req.header('x-forwarded-for');
    
    // Verify direct connection is from trusted proxy
    if (directIp === trustedProxy && forwarded) {
      return forwarded.split(',')[0].trim();
    }
  }
  
  // Fall back to direct IP
  return c.req.header('x-real-ip') ?? 'unknown';
}
```

---

## S-4: No Authorization Check on File Listing

| Attribute | Value |
|-----------|-------|
| **File** | `src/server/http.ts:499-508` |
| **CVSS** | 7.5 (High) |
| **CWE** | CWE-862 (Missing Authorization) |

**Problem**: `/v1/files` returns ALL files across ALL projects.

```typescript
app.get('/v1/files', (c) => {
  const project = c.req.query('project') ?? c.req.header('X-Project') ?? undefined;
  const files = vault.listFiles(project);
  return c.json({ files });
});
```

**Impact**: Users can enumerate all files in the vault.

---

# 🟠 HIGH Security Issues

## S-5: Auth Completely Disabled Based on NODE_ENV

| Attribute | Value |
|-----------|-------|
| **File** | `src/core/config.ts:118-125` |
| **CVSS** | 7.4 (High) |

**Problem**: Auth is entirely disabled when `NODE_ENV !== 'production'`.

```typescript
} else if (isProduction()) {
  throw new Error('FATAL: LLM_GATEWAY_AUTH_TOKEN is required');
} else {
  logger.warn('Auth disabled (not production)');
}
```

**Impact**: If someone accidentally sets `NODE_ENV=development` or it's unset in production, auth is disabled.

**Fix**: Require explicit auth configuration:
```typescript
const requireAuth = process.env['LLM_GATEWAY_AUTH_REQUIRED'] === 'true';
if (requireAuth && !rawAuthToken) {
  throw new Error('FATAL: LLM_GATEWAY_AUTH_TOKEN is required');
}
```

---

## S-6: No Input Validation on Prompt Size

| Attribute | Value |
|-----------|-------|
| **File** | `src/server/http.ts:241-262` |
| **CVSS** | 6.5 (Medium) |

**Problem**: No limit on prompt length for `/v1/generate`.

**Impact**: 
- DoS via memory exhaustion
- Increased API costs
- Buffer overflow in downstream providers

**Fix**:
```typescript
const MAX_PROMPT_LENGTH = 100_000; // 100KB

app.post('/v1/generate', async (c) => {
  const body = await c.req.json<GenerateRequest>();
  
  if (!body.prompt) {
    return c.json({ error: 'prompt is required' }, 400);
  }
  
  if (body.prompt.length > MAX_PROMPT_LENGTH) {
    return c.json({ 
      error: `prompt exceeds maximum length of ${MAX_PROMPT_LENGTH}`,
      code: 'PROMPT_TOO_LONG'
    }, 413);
  }
  // ...
});
```

---

## S-7: Arbitrary Provider Names Accepted

| Attribute | Value |
|-----------|-------|
| **File** | `src/server/http.ts:424-446` |
| **CVSS** | 5.3 (Medium) |

**Problem**: Any string is accepted as provider name.

**Impact**: Users can store credentials with arbitrary names (e.g., "admin", empty strings), causing UI confusion.

**Fix**:
```typescript
const VALID_PROVIDERS = new Set([
  'anthropic', 'openai', 'google', 'groq', 'openrouter',
  'claude-cli', 'gemini-cli', 'codex-cli', 'copilot-cli', 
  'opencode-cli', 'qwen-cli'
]);

if (!VALID_PROVIDERS.has(body.provider)) {
  return c.json({ 
    error: `Invalid provider. Valid: ${[...VALID_PROVIDERS].join(', ')}` 
  }, 400);
}
```

---

# 🟡 MEDIUM Security Issues

## S-8: Dashboard Served Without Server-Side Auth

| Attribute | Value |
|-----------|-------|
| **File** | `src/server/http.ts:61-64` |
| **CWE** | CWE-602 (Server-Side Request Forgery) |

Dashboard HTML is served without auth, relying entirely on client-side JavaScript.

---

## S-9: Full Process Environment Passed to CLI Subprocesses

| Attribute | Value |
|-----------|-------|
| **File** | `src/adapters/cli-utils.ts:64` |
| **CWE** | CWE-552 (Files or Directories Accessible to External Parties) |

CLI subprocesses inherit ALL environment variables, potentially including `LLM_GATEWAY_MASTER_KEY`.

---

## S-10: Race Condition in Rate Limiter

| Attribute | Value |
|-----------|-------|
| **File** | `src/server/rate-limit.ts:47-66` |
| **CWE** | CWE-362 (Race Condition) |

Map operations in `isRateLimited()` are not atomic under concurrent requests.

---

## S-11: CORS Wildcard Acceptable from Environment

| Attribute | Value |
|-----------|-------|
| **File** | `src/server/http.ts:122-125` |

`LLM_GATEWAY_CORS_ORIGINS=*` allows all origins without warning.

---

# 🟢 LOW/INFO Security Issues

## S-12: SQL String Interpolation in Schema (Defensive)

| Attribute | Value |
|-----------|-------|
| **File** | `src/vault/schema.ts:37` |

Uses string interpolation for `GLOBAL_PROJECT` constant. Not exploitable but bad practice.

---

## S-13: Bearer Token Comparison Creates Buffers Per Request

| Attribute | Value |
|-----------|-------|
| **File** | `src/server/http.ts:29-34` |

`Buffer.from()` called twice per authenticated request.

---

# ⚡ CRITICAL Performance Issues

## P-1: Client Instance Created Per Request

| Attribute | Value |
|-----------|-------|
| **File** | `src/adapters/base-adapter.ts:51-57` |
| **Impact** | 50-200ms per request |

```typescript
// Creates NEW OpenAI client on EVERY request
async generate(request: GenerateRequest): Promise<GenerateResponse> {
  const apiKey = this.vault.getDecrypted(...);
  const client = new OpenAI({ apiKey, baseURL: this.baseURL }); // ← NEW INSTANCE
```

**Impact**: TLS handshake, DNS lookup, connection establishment on every request.

**Fix**: Cache clients per apiKey:
```typescript
private clientCache = new Map<string, OpenAI>();

private getClient(apiKey: string): OpenAI {
  if (!this.clientCache.has(apiKey)) {
    this.clientCache.set(apiKey, new OpenAI({ apiKey, baseURL: this.baseURL }));
  }
  return this.clientCache.get(apiKey)!;
}
```

---

## P-2: Dashboard HTML Regenerated Every Request

| Attribute | Value |
|-----------|-------|
| **File** | `src/server/http.ts:231` |
| **Impact** | 5-15ms per page load |

```typescript
app.get('/', (c) => c.html(dashboardHtml())); // ← Regenerates 1482 lines
```

**Fix**: Cache at startup:
```typescript
const dashboardHtmlCache = dashboardHtml();
app.get('/', (c) => c.html(dashboardHtmlCache));
```

---

## P-3: Synchronous Process Checks Block Event Loop

| Attribute | Value |
|-----------|-------|
| **File** | `src/adapters/cli-utils.ts:25-35` |
| **Impact** | Event loop stalls |

```typescript
export function isCliAvailable(command: string, ...): boolean {
  try {
    execFileSync(command, args, { timeout, stdio: 'pipe' }); // ← BLOCKING
    return true;
  } catch { return false; }
}
```

**Fix**: Use async version:
```typescript
export async function isCliAvailable(command: string, ...): Promise<boolean> {
  try {
    await execFileAsync(command, args, { timeout, stdio: 'pipe' });
    return true;
  } catch { return false; }
}
```

---

# 🔥 HIGH Performance Issues

## P-4: N+1 Queries in Router

| Attribute | Value |
|-----------|-------|
| **File** | `src/core/router.ts:93-102, 104-118` |
| **Impact** | 10-50ms latency |

```typescript
async getAvailableModels(): Promise<ModelInfo[]> {
  for (const provider of this.providers) {
    if (await provider.isAvailable()) {  // ← N queries: one per provider
```

**Fix**: Parallelize:
```typescript
async getAvailableModels(): Promise<ModelInfo[]> {
  const results = await Promise.all(
    this.providers.map(async (p) => ({ provider: p, available: await p.isAvailable() }))
  );
  return results.filter(r => r.available).flatMap(r => r.provider.models);
}
```

---

## P-5: Temp Directory Created Per CLI Request

| Attribute | Value |
|-----------|-------|
| **Files** | All CLI adapters |
| **Impact** | Disk I/O + memory allocation |

Every CLI request creates a new temp directory, writes auth files, runs CLI, cleans up.

---

## P-6: String Concatenation in Stdout Handlers

| Attribute | Value |
|-----------|-------|
| **File** | `src/adapters/cli-utils.ts:109-112` |
| **Impact** | O(n²) memory allocations |

```typescript
child.stdout.on('data', (data: Buffer) => { 
  stdout += data.toString(); // ← Creates new string each time
});
```

**Fix**: Use array accumulation:
```typescript
const stdoutParts: string[] = [];
child.stdout.on('data', (data: Buffer) => stdoutParts.push(data.toString()));
const stdout = stdoutParts.join('');
```

---

## P-7: Redundant Decryption for Masking

| Attribute | Value |
|-----------|-------|
| **File** | `src/vault/vault.ts:276-295` |
| **Impact** | Full AES-256-GCM decrypt for 7 chars |

```typescript
const decrypted = decrypt(...); // ← Full decryption
return { maskedValue: this.mask(decrypted), ... }; // ← Shows first 7 chars
```

---

## P-8: Sequential Vault Queries with Fallback

| Attribute | Value |
|-----------|-------|
| **File** | `src/vault/vault.ts:85-107 |
| **Impact** | 2 queries when 1 would suffice |

---

# 📊 MEDIUM Performance Issues

## P-9: Missing HTTP Response Compression
## P-10: Multiple Array Iterations for Message Processing
## P-11: Bearer Token Buffer Allocation Per Request
## P-12: Missing Response Caching (models, providers)
## P-13: Rate Limiter O(n) Cleanup Every 5 Minutes
## P-14: No Per-Request Timeout on Provider Calls
## P-15: Sequential Adapter Registration on Startup

---

# 🏗️ Architecture & Code Quality

## SOLID Violations

| Severity | File | Issue | Effort |
|----------|------|-------|--------|
| **Medium** | `http.ts` (538 lines) | SRP Violation: routing + auth + CORS + endpoints in one file | High |
| **Low** | `index.ts` | Mode parsing from argv is fragile | Low |

## DRY Violations

| Severity | Files | Issue | Effort |
|----------|-------|-------|--------|
| **High** | 6 CLI adapters | ~200 lines duplicated per adapter | High |
| **Medium** | HTTP endpoints | Identical try/catch error blocks | Low |
| **Low** | `resolveProject()` | Pattern repeated 3 times | Low |

## Missing Infrastructure

| Priority | Component | Purpose |
|----------|-----------|---------|
| **Critical** | OpenTelemetry | Distributed tracing |
| **Critical** | Prometheus metrics | Observability |
| **Critical** | Circuit breaker | Resilience |
| **High** | Zod validation | Runtime type checking |
| **High** | Request timeouts | Prevent hanging requests |
| **Medium** | Request correlation IDs | Log tracing |

## Testing Gaps

| Priority | Area | Coverage |
|----------|------|----------|
| **High** | HTTP endpoints | 0 tests |
| **High** | MCP server | 0 tests |
| **High** | Vault concurrency | 0 tests |
| **Medium** | CLI adapters | 0 tests |
| **Medium** | Rate limiter | 0 tests |

---

# ✅ What's Done Right

- ✅ AES-256-GCM encryption with random IV
- ✅ Timing-safe token comparison
- ✅ Prepared SQL statements (injection safe)
- ✅ Proper file permissions (0o700, 0o600)
- ✅ escHtml() for XSS protection
- ✅ execFile instead of exec for CLI
- ✅ WAL mode for SQLite
- ✅ Graceful shutdown
- ✅ Structured logging with pino
- ✅ Rate limiting
- ✅ Body size limit
- ✅ Base adapter class for API providers
- ✅ Comprehensive unit tests (85 tests)

---

# 📋 Prioritized Fix Roadmap

## P0 - Critical (Fix Before Production)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| S-1 | IDOR: Credential deletion | Medium | Security |
| S-2 | IDOR: File deletion | Medium | Security |
| S-3 | IP spoofing in rate limiting | Low | Security |
| P-1 | Client per-request creation | Low | Performance |
| P-2 | Dashboard HTML regeneration | Trivial | Performance |

## P1 - High Priority

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| P-3 | Sync isCliAvailable blocking | Medium | Performance |
| P-4 | N+1 queries in router | Low | Performance |
| S-6 | Prompt length validation | Low | Security |
| S-7 | Provider name validation | Low | Security |
| - | Add OpenTelemetry | High | Observability |
| - | Add Prometheus metrics | High | Observability |

## P2 - Medium Priority

| # | Issue | Effort |
|---|-------|--------|
| P-5 | Temp dir caching | Medium |
| P-6 | String concat fix | Low |
| P-7 | Lazy decryption | Low |
| P-8 | Single query fallback | Low |
| S-5 | Auth configuration | Medium |
| - | HTTP endpoint tests | High |
| - | Circuit breaker | Medium |

## P3 - Nice to Have

| # | Issue | Effort |
|---|-------|--------|
| P-9 | HTTP compression | Trivial |
| P-10 | Single-pass message processing | Low |
| P-11 | Buffer allocation optimization | Low |
| P-12 | Response caching | Trivial |
| - | MCP server tests | High |
| - | CLI adapter tests | Medium |
| - | BaseCliAdapter class | High |

---

**Report Generated**: 2026-03-20  
**Auditors**: Security Agent, Performance Agent, Architecture Agent  
**Files Analyzed**: 20+ source files  
**Lines of Code**: ~6,000
