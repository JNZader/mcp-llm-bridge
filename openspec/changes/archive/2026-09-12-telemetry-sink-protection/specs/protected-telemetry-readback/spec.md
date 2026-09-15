# Protected Telemetry Readback Specification

## Purpose

Define default-deny projections for HTTP, MCP, dashboard, administrative, and adapter readback of request logs, usage, analytics, ordinary logs, traces, and metrics.

## Requirements

### Requirement: Safe Readback Projection

Every routine readback boundary MUST return only the declared typed safe projection for its sink class. Raw storage records, arbitrary stored fields, protected content, and undeclared metadata MUST NOT be returned.

#### Scenario: Authorized routine readback is projected

- GIVEN an authorized caller requests a supported telemetry record
- WHEN HTTP, MCP, dashboard, administrative, or adapter readback serves it
- THEN only declared bounded fields and opaque identifiers are returned
- AND storage-only or undeclared fields are absent

#### Scenario: Historical canary is not projected

- GIVEN a stored record contains a protected-content canary in a raw or unknown field
- WHEN any routine readback path retrieves the record
- THEN the canary and its field are absent from the response
- AND no serialization fallback exposes the raw record

### Requirement: Readback Authorization and Scoping

Readback MUST deny access unless the surrounding authorization boundary explicitly grants the requested capability and scope. Missing, invalid, or indeterminate scope MUST fail closed without disclosing record existence.

#### Scenario: Missing authorization reveals nothing

- GIVEN a caller lacks the required readback capability or scope
- WHEN the caller requests telemetry by list, filter, or opaque identifier
- THEN access is denied with a normalized safe error
- AND the response does not reveal whether matching records exist

### Requirement: Usage Error Compatibility

Usage readback MUST preserve `errorMessage` as a bounded compatibility-safe value and MUST provide a stable safe error code or category. It MUST NOT return provider free text through `errorMessage` or any alternate field.

#### Scenario: Existing client receives safe failure fields

- GIVEN a usage record created from a provider error containing a unique canary
- WHEN an authorized client reads that usage record
- THEN `errorMessage` contains only approved compatibility text
- AND a stable safe code or category is present and the canary is absent

### Requirement: Legacy Records Are Not Routine Readback

Records classified as legacy-sensitive MUST be excluded from all routine readback, list, search, aggregate, and export paths.

#### Scenario: Legacy identifier cannot bypass isolation

- GIVEN a caller knows the opaque identifier of a legacy-sensitive record
- WHEN the caller uses any routine readback path
- THEN the record is not returned
- AND the response does not disclose its legacy classification or protected content
