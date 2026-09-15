# Proposal: WP-00 Containment and Evidence Harness

## Executive Decision

Create a reversible default-deny layer: unverified properties remain private, redacted, disabled, unavailable, Unknown, or qualified.

## Intent

Current defaults can expose services, admit absent-config administration/OAuth, retain content, run providers in tests, show false-green health, silently synchronize, and overstate readiness. WP-00 reduces privacy/security risk and establishes reproducible evidence before structural work.

## Scope Decision

**Hold.** Preserve exactly seven approved outcomes. Expansion would mix later lifecycle, tenancy, cost, UI-join, artifact-parity, and identity concerns into the rollback boundary; reduction would leave the invariant unenforced.

## Scope

### In Scope

1. Private-by-default HTTP exposure; remote access requires trusted configuration and static authentication.
2. Fail-closed admin/OAuth configuration, allowlists, and disallowed identities.
3. Metadata-only/redacted telemetry; content and credential canaries never persist.
4. Hermetic default tests: loopback allowed, non-loopback egress and provider executables denied.
5. Missing model, circuit, or cost evidence renders **Unknown**; public claims stay qualified.
6. Model/price auto-sync remains off at startup; manual admin sync is explicit.
7. Required CLIs fail construction when absent, or optional CLIs and readiness claims are downgraded.

### Out of Scope / Non-Goals

No WP-01 AuthenticatedScope, WP-05 lifecycle ownership, WP-07 durable cost truth, WP-08 atomic sync, WP-09 fully scoped telemetry, WP-10 authoritative UI joins, WP-11 compiled-artifact parity, or WP-12 generated identity. SCAN-BIN-01..14 remain unchanged.

## Capabilities

### New Capabilities

- `default-deny-containment`: shared invariant and negative evidence across all seven outcomes; future normative requirements live at `specs/default-deny-containment/spec.md`.

### Modified Capabilities

None exist in the current main OpenSpec store.

## Approach and Affected Areas

Add behavior-first negative controls, minimal fail-closed defaults, a hermetic sentinel, **Unknown** rendering, and claim/config qualification across HTTP/auth, telemetry, tests, dashboards, synchronization, Docker/Compose, and bilingual documentation. Later phases migrate validated detail losslessly into `specs/default-deny-containment/spec.md`, `design.md`, and `tasks.md`.

## Constraints, Handoff, and Risk

Evidence must be candidate-bound, independently validated read-only, privacy-safe, and truthful about publication/distribution. SAFE-CORE and SCAN-BIN work exists; SCAN-BIN has manual 14-scenario remediation evidence but awaits a fresh gate. No dependent apply, final verify, RDD approval, or delivery is authorized. Planning retains `ask-on-risk` resolved as unchained `size:exception`, without delivery authority.

Risks include reachability regression, loopback rejection, overbroad redaction, false claims, and review-size pressure.

## Rollback Plan

Disable the affected surface or restore the last verified private configuration; never restore fail-open access, telemetry, synchronization, publication, or readiness.

## Success / Planning Exit Criteria

- [ ] Specs preserve the invariant, seven domains, scenarios, evidence/admission constraints, exclusions, and rollback.
- [ ] Design and tasks are migrated losslessly with relative links and traceability.
- [ ] Proposal, specs, design, and tasks pass readback before apply resumes.

## Non-Normative Provenance

Historical sources: validated Engram #20055, #20062, #20191, #20398, #20439, #20448, and #20454. This OpenSpec change is normative.
