# Authorized Comparison Capability Specification

## Purpose

Preserve comparison prompts and responses only as a separately authorized product capability, never as ordinary telemetry or incidental history.

## Requirements

### Requirement: Explicit Comparison Authorization

Comparison content persistence and every comparison readback entry point MUST require the explicit comparison capability and applicable scope. Authorization MUST be checked independently of ordinary telemetry access.

#### Scenario: Authorized comparison round trip

- GIVEN a caller has the explicit comparison capability for the requested scope
- WHEN the caller persists and later reads comparison content
- THEN the operation succeeds through the comparison boundary
- AND the access is auditable without copying protected content into the audit record

#### Scenario: Ordinary telemetry authority is insufficient

- GIVEN a caller may read ordinary telemetry but lacks the comparison capability
- WHEN the caller attempts comparison persistence, list, detail, search, or export
- THEN the operation is denied before persistence or disclosure
- AND no comparison record existence or content is revealed

### Requirement: Comparison Isolation

Comparison prompts, system prompts, responses, and summaries MUST NOT enter request logs, usage, analytics, ordinary logs, traces, metrics, or their routine readback projections. Comparison references exposed outside the capability MUST be opaque and MUST NOT encode content or identity.

#### Scenario: Comparison canaries remain isolated

- GIVEN unique canaries in each comparison content field
- WHEN an authorized comparison completes
- THEN the canaries are available only through authorized comparison readback
- AND no canary appears in any ordinary telemetry sink or readback

### Requirement: Comparison Legacy Isolation

Existing comparison rows containing sensitive content MUST be classified as legacy until explicitly migrated or deleted. Legacy comparison rows MUST receive no new writes and MUST NOT be available through routine or newly authorized comparison readback.

#### Scenario: Authorization does not unlock legacy rows

- GIVEN an authorized comparison caller requests a legacy row directly
- WHEN comparison readback evaluates the request
- THEN the row is denied without exposing content
- AND the attempt produces content-free audit evidence

### Requirement: Comparison Retention

Authorized comparison history MUST expire after 30 days and MUST support authorized deletion plus verification that expired and selected records are no longer readable.

#### Scenario: Expired comparison is deleted and denied

- GIVEN an authorized comparison record is older than 30 days
- WHEN scheduled or explicit deletion completes
- THEN verification reports the record absent by age and opaque identifier
- AND subsequent authorized readback cannot return it
