# Telemetry Retention and Deletion Specification

## Purpose

Apply a maintainer-selected 30-day limit independently to every protected sink and exporter. This duration is not an externally researched or compliance-mandated value.

## Requirements

### Requirement: Independent Thirty-Day Policies

Request logs, usage, analytics, authorized comparison history, ordinary logs, traces, and metrics MUST each have an independently named 30-day retention policy, deletion owner, and completion signal. Data whose age reaches 30 days MUST be expired.

| Data class | Required verification |
|---|---|
| Request logs | Expired age and count are absent |
| Usage | Expired rows are absent from sink queries |
| Analytics | Expired aggregates are absent and exporter completion is confirmed |
| Authorized comparison history | Expired records are absent and readback is denied |
| Ordinary logs | Backend expiry or deletion is confirmed |
| Traces | Collector and backend expiry or deletion is confirmed |
| Metrics | Backend expiry or deletion is confirmed |

#### Scenario: Each data class expires independently

- GIVEN records on both sides of the 30-day cutoff for every data class
- WHEN each data class's deletion control completes
- THEN records older than 30 days are absent from storage and readback
- AND newer records remain subject to their own policy

### Requirement: Deletion Verification

Deletion MUST produce sink-specific evidence using ages, counts, opaque identifiers, or backend confirmations. Verification evidence MUST NOT contain protected content, and a failed or indeterminate check MUST NOT be reported as successful deletion.

#### Scenario: Verification failure stays visible

- GIVEN deletion runs but one sink cannot confirm expiry
- WHEN completion is evaluated
- THEN that sink is reported as unverified or failed
- AND other sink confirmations do not mask the failure

### Requirement: External Sink Limits

Local write protection or deletion MUST NOT be represented as deleting data already exported. Each configured external log, trace, metric, or analytics backend MUST have its own 30-day retention and deletion/expiry verification; a backend lacking those controls MUST NOT receive protected telemetry.

#### Scenario: Unsupported external backend fails closed

- GIVEN an external backend cannot enforce or verify the 30-day policy
- WHEN export eligibility is evaluated
- THEN export to that backend is denied
- AND the system reports the backend limitation without protected content

#### Scenario: Local deletion does not overclaim

- GIVEN data was previously exported to an external backend
- WHEN the corresponding local record is deleted
- THEN local verification reports only local deletion
- AND external deletion remains incomplete until backend verification succeeds

### Requirement: Policy Provenance

Documentation and operator-visible retention status MUST identify 30 days as a maintainer decision and MUST NOT describe it as externally evidenced, legally sufficient, or compliance mandated.

#### Scenario: Retention provenance is accurate

- GIVEN retention status or guidance is presented
- WHEN a maintainer reviews its provenance statement
- THEN it identifies the 30-day value as a maintainer decision
- AND it makes no external research or compliance claim
