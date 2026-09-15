# Protected Telemetry Sinks Specification

## Purpose

Define fail-closed write and export boundaries for request logs, usage, analytics, ordinary logs, traces, and metrics. This capability does not modify or complete SAFE-CORE, W01, or WP00.

## Requirements

### Requirement: Closed Sink Projections

Each protected sink boundary MUST accept only its declared, bounded typed metadata projection. Undeclared fields, nested objects, and arbitrary key/value context MUST be denied before any durable write, emission, or export occurs.

#### Scenario: Declared metadata is accepted

- GIVEN a valid declared projection for each protected sink class
- WHEN the projection crosses that sink's write or export boundary
- THEN only the declared bounded fields are emitted
- AND no request or response payload field is created implicitly

#### Scenario: Direct caller cannot bypass the boundary

- GIVEN a direct sink caller includes an undeclared field or nested object
- WHEN the caller attempts a write or export
- THEN the boundary denies the operation before any sink side effect
- AND the denial exposes no rejected value

### Requirement: Protected Content Exclusion

Protected sinks MUST NOT accept prompts, system prompts, responses, credentials, authorization material, arbitrary context, or provider free-text errors, regardless of field name, nesting, encoding, or truncation.

#### Scenario: Negative canary matrix is blocked

- GIVEN unique canaries for every protected content class
- WHEN each canary is submitted to request logs, usage, analytics, ordinary logs, traces, and metrics
- THEN no canary appears in durable data, emitted records, attributes, labels, or exports
- AND each rejected operation follows the sink's safe failure contract

### Requirement: Opaque and Explicit Metadata

Retained identifiers MUST be opaque and MUST have an explicit exposure and scoping contract. Identity, project, provider, model, route, and correlation metadata MUST default to denied unless the sink projection declares a bounded safe representation and authorized purpose.

#### Scenario: Undeclared identifying metadata is denied

- GIVEN metadata containing a human-readable identity or undeclared identifier
- WHEN it crosses a protected sink boundary
- THEN the boundary denies or omits that field according to its declared contract
- AND no substitute derived from the sensitive value is emitted

### Requirement: Safe Failure Normalization

Protected sinks MUST represent failures only with stable safe codes, bounded categories, and approved compatibility text. Provider free-text errors MUST NOT cross a protected sink boundary.

#### Scenario: Provider failure becomes safe metadata

- GIVEN a provider error containing a unique sensitive canary
- WHEN the failure is recorded by any protected sink
- THEN the record contains only the approved safe code and category
- AND the canary is absent from every sink and exporter
