# Default-Deny Containment Specification

This normative specification preserves the proposal's **Hold** scope: exactly seven approved outcomes—HTTP exposure, admin/GitHub OAuth, telemetry privacy, hermetic default tests, evidence/public truth, synchronization startup, and container/CLI claims. Unverified trust, privacy, execution, health, synchronization, and distribution properties remain disabled, private, redacted, unavailable, Unknown, or qualified. See [the proposal](../../proposal.md#scope-decision).

## Default-deny invariant

### Requirement: REQ-00 Shared containment

Trust, privacy, execution, health, synchronization, and distribution properties **MUST** remain disabled, private, redacted, unavailable, or qualified unless explicit evidence and trusted configuration establish them. Rollback **MUST** disable the affected surface or restore the last verified private configuration; it **MUST NOT** restore fail-open access or telemetry.

#### Scenario: Safe rollback
- **GIVEN** a containment change is withdrawn or its evidence becomes invalid
- **WHEN** rollback is requested
- **THEN** the service remains private/disabled and prior fail-closed behavior is restored

## Requirements

### Requirement: REQ-HTTP-01 HTTP exposure
The service **MUST** bind to loopback/private interfaces by default. Non-loopback exposure **MUST** require explicit trusted configuration plus static authentication; implicit or incomplete configuration **MUST NOT** widen exposure.

#### Scenario: Default private binding
- **GIVEN** no trusted exposure configuration
- **WHEN** the service starts
- **THEN** loopback/private access is available and non-loopback access is denied

#### Scenario: Explicit remote access
- **GIVEN** trusted non-loopback configuration and valid static authentication
- **WHEN** a remote request is received
- **THEN** it is admitted; without either prerequisite it is denied

### Requirement: REQ-AUTH-01 Admin and GitHub OAuth
Admin and GitHub OAuth paths **MUST** fail closed when configuration is absent or incomplete. An empty allowlist and every disallowed user **MUST** be denied.

#### Scenario: Missing configuration
- **GIVEN** absent admin credentials or incomplete OAuth policy
- **WHEN** an admin/OAuth attempt occurs
- **THEN** access is denied without issuing an administrative session

#### Scenario: Allowlist enforcement
- **GIVEN** a non-empty policy allowlist
- **WHEN** an allowed and a disallowed identity attempt login
- **THEN** only the allowed identity succeeds

### Requirement: REQ-TELEM-01 Telemetry privacy
Persisted and exported telemetry **MUST** be metadata-only and redacted by default. Prompt, response, and credential canaries **MUST NOT** appear in logs, traces, errors, audit records, or durable telemetry.

#### Scenario: Canary rejection
- **GIVEN** a request containing prompt, response, and credential canaries
- **WHEN** telemetry is emitted and persisted
- **THEN** none of the canaries is recoverable from any telemetry surface

### Requirement: REQ-TEST-01 Hermetic default tests
The default test lane **MUST** allow loopback fixtures but **MUST** deny non-loopback network egress and provider executable invocation. An explicit live-provider lane **MUST** remain opt-in and outside the default command.

#### Scenario: Offline positive control
- **GIVEN** a loopback-only fixture
- **WHEN** the default suite runs
- **THEN** it completes without provider credentials, external network, or provider executable use

#### Scenario: Egress/executable negative controls
- **GIVEN** a test attempts non-loopback egress or a provider executable
- **WHEN** the default suite runs
- **THEN** the sentinel fails the attempt and the suite reports a hermetic failure

### Requirement: REQ-TRUTH-01 Evidence and public truth
Missing model, circuit, or cost evidence **MUST** render **Unknown**, never numeric zero, healthy/CLOSED, disabled, or unavailable. Public documentation, UI, badges, and readiness language **MUST** qualify incomplete evidence and **MUST NOT** claim WP-11 production readiness.

#### Scenario: Missing evidence
- **GIVEN** model, circuit, or cost evidence is absent or stale
- **WHEN** API/UI status is rendered
- **THEN** the value is explicitly Unknown and distinct from zero, CLOSED/healthy, disabled, and unavailable

#### Scenario: Qualified claim
- **GIVEN** container, provider, or cost evidence is incomplete
- **WHEN** a public claim is shown
- **THEN** it is labeled partial/conditional/development or equivalent, not production-ready

### Requirement: REQ-SYNC-01 Synchronization startup
Startup **MUST** leave model/price auto-sync disabled. Manual or administrator-triggered synchronization **MAY** exist only as an explicit action with observable outcome; startup **MUST NOT** silently schedule it.

#### Scenario: Startup
- **GIVEN** a normal service start
- **WHEN** scheduler state is inspected
- **THEN** automatic model/price synchronization is off

### Requirement: REQ-DIST-01 Container and CLI claims
A CLI declared optional **MUST** be identified as optional wherever documented and its readiness claim downgraded accordingly. A CLI still declared required **MUST** cause container construction to fail when missing or unverifiable; successful construction **MUST NOT** mask that absence.

#### Scenario: Optional CLI
- **GIVEN** an optional provider CLI is absent
- **WHEN** image/docs/readiness are evaluated
- **THEN** construction may continue but the CLI and claim are explicitly optional

#### Scenario: Required CLI
- **GIVEN** a required CLI is absent or unverifiable
- **WHEN** the container is constructed
- **THEN** construction fails with a non-ready result

## Admission, evidence, and scope constraints

Implementation admission **MUST** require an approved conforming issue, clean refreshed-main reproduction, dedicated clean worktree, operator-flow inventory, behavior-first tests, no more than 400 authored changed lines (or an explicit chain/size exception), and candidate-bound independent read-only validation. SAFE-CORE and SCAN-BIN-01..14 remain unchanged; implementation evidence is not fresh gate approval. The Hold scope is exactly these seven outcomes; no expansion is permitted.

Non-goals are WP-01 AuthenticatedScope, WP-05 lifecycle redesign, WP-07 durable cost truth, WP-08 atomic sync, WP-09 full tenant-scoped telemetry, WP-10 authoritative UI joins, WP-11 compiled-artifact parity, and WP-12 generated identity.

## Rollback

Rollback **MUST** disable the affected surface or restore the last verified private configuration. It **MUST NOT** restore fail-open access, telemetry, synchronization, publication, or readiness.

## Non-normative provenance

Source: validated Engram observation #20062; drift guards #20055 and #20191. These historical identifiers are provenance only; this file is normative.
