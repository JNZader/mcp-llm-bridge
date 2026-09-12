# Telemetry Migration and Rollback Specification

## Purpose

Define forward migration, legacy isolation, compatibility transition, and rollback behavior without re-enabling unsafe writes or readback.

## Requirements

### Requirement: Forward Migration Fails Closed

Forward migration MUST prevent new writes to raw sensitive fields before protected projections become routine. Existing rows containing arbitrary JSON or text MUST be isolated as legacy or deleted; migration MUST NOT claim that lossy transformation reconstructs safe values.

#### Scenario: Legacy canary survives only in isolation

- GIVEN a pre-migration row contains a protected-content canary
- WHEN forward migration completes without purging that row
- THEN the row is marked and isolated as legacy
- AND new writes and routine readback cannot reach it

#### Scenario: New raw write is rejected after migration

- GIVEN migration is complete
- WHEN a legacy writer attempts to persist raw request, response, context, or provider error text
- THEN the write is denied before any durable side effect
- AND no fallback column or compatibility path stores the value

### Requirement: Deliberate Consumer Compatibility

Removed sensitive fields MUST follow an explicit versioning or deprecation contract. Preserved fields MUST retain safe semantics; notably, usage `errorMessage` MUST remain bounded compatibility text alongside a safe code or category.

#### Scenario: Removed field is not silently repurposed

- GIVEN a consumer requests a formerly sensitive field
- WHEN the transitioned readback contract handles the request
- THEN the documented versioning or deprecation behavior occurs
- AND the field is not populated with raw, misleading, or reconstructed content

### Requirement: Safe Rollback

Rollback MUST NOT restore raw writes, provider free-text propagation, routine legacy readback, or unauthorized comparison access. If reversing a schema change would weaken these invariants, the stricter schema MUST remain and the affected capability MUST stay isolated pending forward repair.

#### Scenario: Rollback preserves protection

- GIVEN a migrated capability must be rolled back
- WHEN the rollback completes
- THEN negative canaries remain rejected at every affected sink and readback boundary
- AND legacy rows and comparison content remain isolated under their authorization rules

#### Scenario: Unsafe reverse migration is refused

- GIVEN a reverse migration would recreate an unsafe writable or readable field
- WHEN rollback is requested
- THEN that reverse migration is denied or skipped
- AND the stricter boundary remains active with a safe operational status

### Requirement: Migration and Rollback Verification

Migration and rollback completion MUST be verified separately for write rejection, routine readback denial, authorized comparison behavior, and legacy isolation.

#### Scenario: Partial verification cannot pass

- GIVEN one required migration or rollback verification is missing or fails
- WHEN overall completion is evaluated
- THEN the operation is not reported as fully verified
- AND the unresolved boundary is identified without exposing protected content
