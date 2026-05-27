# Wiring Sprint Strategy — ROI + DX + WPI-First

**Project:** mcp-llm-bridge  
**Date:** 2026-05-27  
**Author:** Technical Writing Team  
**Status:** Draft — Awaiting Review

---

## 1. Executive Summary

The `mcp-llm-bridge` codebase currently contains **10+ features that are partially implemented but unwired** — effectively "dead code." These Work In Progress (WPI) items represent significant invested engineering effort that delivers zero value to consumers because they are not integrated into the runtime, the server layer, or the public API surface.

This document proposes a **Wiring Sprint Strategy** with three guiding principles:

| Principle | What It Means |
|-----------|---------------|
| **WPI-First** | Close every partially-built feature before writing any green-field code. |
| **ROI-Driven** | Prioritize features that deliver immediate value to existing consumers: `biogas`, `ghagga`, `javi-ai`, and `repoforge`. |
| **DX-First** | Prioritize improvements that are felt immediately in every developer session (security enforcement, prompt quality, compression, local LLM support). |

> **Bottom line:** Wiring existing code is ~70% cheaper than building new features from scratch, eliminates dead-code confusion, and delivers backward-compatible value to all four consumers immediately.

---

## 2. The Dead Code Problem

The following table inventories every partially implemented feature, its completion percentage, and the single blocker preventing it from delivering value.

| # | Feature | Completion | Blocker | Consumer Impact |
|---|---------|-----------|---------|-----------------|
| 1 | **Security Profiles** | ~90% | HTTP bypass is critical — profiles exist but are not enforced on the HTTP surface | **HIGH** — all 4 consumers |
| 2 | **Approval Flows** | ~40% | Core logic stubbed; not wired into request lifecycle | **HIGH** — all 4 consumers |
| 3 | **Docker Sandbox** | ~50% | Sandbox manager exists but has zero consumer integration | **LOW** — no active consumer |
| 4 | **Three-Part Prompt** | 100% | Code complete but never registered in the prompt engine | **MEDIUM** — all 4 consumers |
| 5 | **RTK Compression** | 100% | Algorithm done but not integrated into token pipeline | **MEDIUM** — all 4 consumers |
| 6 | **Hybrid RRF** | RRF done | No vector or BM25 backends wired; ranking layer is orphaned | **LOW** — retrieval consumers only |
| 7 | **ACP Protocol** | Skeleton | Protocol definitions exist but no transport or handshake wired | **XL strategic** — future cross-agent comms |
| 8 | **MCP Builder** | Functional | Builder class works but is not exposed through CLI or server API | **MEDIUM** — template consumers |
| 9 | **Local LLM Offloading** | ~550 LOC | Offloading logic written but not connected to model routing or server | **HIGH** — `javi-ai`, `repoforge` |
| 10 | **Model Routing** | ~370 LOC | Router implemented but depends on unified classifier taxonomy that does not yet exist | **HIGH** — all 4 consumers |
| 11 | **HF Auto-Discovery** | ~470 LOC | Discovery logic written but not wired to model catalog or server bootstrap | **MEDIUM** — `biogas`, `ghagga` |

### Cumulative Impact

- **~1,900 LOC** of written, tested code sits idle.
- **~4 features** are 100% complete but invisible.
- **Security bypass** is the single largest operational risk.
- Every new developer onboarding to the project asks: *"Is this feature real or not?"*

---

## 3. Wiring Sprint Scope

### 3.1 IN Scope — This Sprint

The following features will be wired, tested, documented, and released:

| Feature | Why Included |
|---------|-------------|
| **Unification of classifiers** | Prerequisite for Model Routing; unblocks Sprint 3 routing logic. |
| **Approval Flows + HTTP Security Enforcement** | Closes the #1 and #2 security risks. Immediate DX win for every session. |
| **Three-Part Prompt** | 100% complete — pure wiring. Improves prompt quality for all consumers. |
| **RTK Compression** | 100% complete — pure wiring. Reduces token cost immediately. |
| **Local LLM Offloading** | High consumer demand (`javi-ai`, `repoforge`). Code is mature. |
| **HF Auto-Discovery** | Reduces manual model catalog maintenance. Mature code. |

### 3.2 OUT of Scope — Deferred

| Feature | Deferral Rationale |
|---------|-------------------|
| **Docker Sandbox** | No active consumer. Building the integration now would be speculative. |
| **ACP Protocol** | XL strategic feature. Requires design review with cross-agent teams. |
| **Hybrid RRF** | Needs vector and BM25 backends that do not yet exist in the project. |
| **Model Routing** | Depends on **classifier unification** (Sprint 0). Will be picked up immediately after unification is merged. |
| **MCP Builder** | Template layer is incomplete. Exposing a half-built builder worsens DX. |
| **All green-field features** | Workflow Builder, Multi-Backend Storage, JSONL Streaming, Unified Tool Catalog — none start until WPI is closed. |

---

## 4. Prioritization Table

Sprints are calendar-time estimates assuming **1 senior + 1 mid-level developer**.

| Sprint | Focus | Duration | Deliverables | Risk Level |
|--------|-------|----------|-------------|------------|
| **Sprint 0** | Unification of classifiers | ~2 days | Unified classifier taxonomy merged; Model Routing unblocked | Low |
| **Sprint 1** | Approval Flows + HTTP Security Enforcement | ~5 days | Security profiles enforced on HTTP surface; approval gates wired into request lifecycle; bypass closed | **High** |
| **Sprint 2** | Three-Part Prompt + RTK Compression | ~5 days | Prompt registered in engine; compression integrated into token pipeline; integration tests | Low |
| **Sprint 3** | Local LLM + HF Discovery | ~5 days | Offloading connected to router; HF discovery wired to catalog bootstrap; server config updated | Medium |
| **Post-sprint** | Model Routing, Hybrid RRF, MCP Builder, ACP Protocol | TBD | Ordered by dependency and consumer demand | Medium → High |

### Dependency Chain

```
Sprint 0: Classifier Unification
    │
    ▼
Sprint 1: Approval Flows + HTTP Enforcement
    │
    ▼
Sprint 2: Three-Part Prompt + RTK Compression
    │
    ▼
Sprint 3: Local LLM + HF Discovery
    │
    ▼
Post:   Model Routing (requires Sprint 0)
        Hybrid RRF (needs backends)
        MCP Builder (needs templates)
        ACP Protocol (strategic)
```

---

## 5. ROI Justification

### 5.1 Cost Efficiency

| Approach | Relative Cost | Rationale |
|----------|--------------|-----------|
| **Wiring existing code** | ~30% of green-field cost | Code is written, reviewed, and unit-tested. Cost = integration + tests + docs. |
| **Green-field feature** | 100% baseline | Design + implementation + review + integration + tests + docs. |

> **Wiring is ~70% cheaper** because the hardest phases (design, implementation, unit tests) are already complete.

### 5.2 Value Delivery

Every closed WPI delivers value to **all four consumers simultaneously**:

| Feature | `biogas` | `ghagga` | `javi-ai` | `repoforge` |
|---------|:--------:|:--------:|:---------:|:-----------:|
| Security Profiles + HTTP Enforcement | ✅ | ✅ | ✅ | ✅ |
| Approval Flows | ✅ | ✅ | ✅ | ✅ |
| Three-Part Prompt | ✅ | ✅ | ✅ | ✅ |
| RTK Compression | ✅ | ✅ | ✅ | ✅ |
| Local LLM Offloading | — | — | ✅ | ✅ |
| HF Auto-Discovery | ✅ | ✅ | — | — |

### 5.3 Technical Debt Reduction

- **Less confusion:** Dead code is the #1 source of "is this real?" questions during onboarding.
- **Safer refactors:** Wired features are covered by integration tests; dead code rots silently.
- **Lower risk:** Existing code has already passed CI. Wiring does not introduce new untested surfaces.

---

## 6. Security Critical Path

Two items dominate the risk profile:

### 6.1 HTTP Bypass — Risk #1

- **Current state:** Security profiles exist in configuration but are **not enforced** on the HTTP server surface.
- **Impact:** Any request that bypasses the MCP layer can execute without profile checks.
- **Mitigation:** Sprint 1 MUST integrate profile enforcement into `src/server/http.ts` before any other HTTP-facing work.

### 6.2 Approval Flows — Risk #2

- **Current state:** Approval logic is ~40% complete; no gate exists in the request lifecycle.
- **Impact:** Sensitive operations (tool execution, model switching, file access) proceed without user or system approval.
- **Mitigation:** Sprint 1 MUST wire approval checks into `src/server/mcp.ts` and the HTTP execution pipeline.

### 6.3 Policy

> **No new execution surfaces** (tool catalog expansion, workflow nodes, custom tool loading) will be merged until both HTTP enforcement and approval flows are wired and integration-tested.

---

## 7. Definition of Done for Wiring Sprint

A feature is considered **wired and done** only when ALL of the following are true:

### 7.1 Runtime Integration

- [ ] Feature is imported and registered in `src/index.ts` (public API surface).
- [ ] Feature is wired into `src/server/mcp.ts` (MCP transport layer).
- [ ] Feature is wired into `src/server/http.ts` (HTTP transport layer) if applicable.

### 7.2 Testing

- [ ] Integration tests exist that exercise the feature through the MCP layer.
- [ ] Integration tests exist that exercise the feature through the HTTP layer (if applicable).
- [ ] All existing unit tests continue to pass.
- [ ] CI pipeline is green.

### 7.3 Documentation

- [ ] Feature is documented in `README.md` with usage example.
- [ ] Configuration schema (if any) is documented.
- [ ] Dashboard UI is updated to expose feature status/controls where applicable.

### 7.4 Consumer Contract

- [ ] Feature is **backward compatible** — no consumer code changes required to adopt.
- [ ] Feature is **opt-in by default** where behavioral change is significant.
- [ ] CHANGELOG entry is added.

### 7.5 Sprint Exit Checklist

| Checkpoint | Sprint 0 | Sprint 1 | Sprint 2 | Sprint 3 |
|------------|:--------:|:--------:|:--------:|:--------:|
| All DoD items above complete | ✅ | ✅ | ✅ | ✅ |
| Security review passed | N/A | ✅ | ✅ | ✅ |
| Consumer smoke test passed | N/A | ✅ | ✅ | ✅ |
| Dashboard UI updated | N/A | ✅ | ✅ | ✅ |
| CHANGELOG merged | ✅ | ✅ | ✅ | ✅ |

---

## 8. Glossary

| Term | Definition |
|------|-----------|
| **WPI** | Work In Progress — partially implemented features that are not yet delivering value. |
| **Dead code** | Code that exists in the repository but is not executed in production or integrated into any runtime path. |
| **Green-field** | A feature built from scratch with no prior implementation. |
| **Wiring** | The act of connecting an existing implementation into the runtime, server layer, and public API. |
| **ROI** | Return on Investment — the ratio of value delivered to engineering cost. |
| **DX** | Developer Experience — the quality of interaction developers have with the system. |
| **RRF** | Reciprocal Rank Fusion — a ranking algorithm for hybrid search results. |
| **RTK** | Runtime Token — internal token format used by the bridge. |
| **HF** | Hugging Face — model hub and inference API provider. |
| **ACP** | Agent Communication Protocol — strategic cross-agent messaging layer. |

---

## 9. Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1 | 2026-05-27 | Technical Writing Team | Initial draft |

---

*End of Document*
