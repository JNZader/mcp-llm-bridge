# Plugin Runtime Cancellation

Opt-in persistent workers and cancellable imports. No implementation, limits, names, or schemas are selected; those remain design choices. Hard-time, sandbox, rollback, descendant-process, and native-I/O guarantees are explicit non-goals.

## ADDED Requirements

### Requirement: Legacy default and explicit opt-in
Worker mode MUST be off by default; valid explicit opt-in is required; invalid opt-in MUST fail.
#### Scenario: Legacy default
- **GIVEN** no opt-in; **WHEN** load; **THEN** legacy path only.
#### Scenario: Explicit opt-in
- **GIVEN** valid opt-in; **WHEN** load; **THEN** validate and enter worker mode.

### Requirement: Minimal environment and bounded diagnostics
Workers MUST receive only allowlisted environment. Captured stdout/stderr MUST be bounded and MUST NOT project bytes onto MCP stdout or unbounded channels.
#### Scenario: Environment isolation
- **GIVEN** non-allowlisted variable; **WHEN** start; **THEN** unavailable.
#### Scenario: Output bound
- **GIVEN** output exceeds budget; **WHEN** capture; **THEN** bounded overflow, never raw MCP stdout.

### Requirement: Exact bounded JSON protocol and correlation
Versioned envelopes/manifests, arguments/results, and request IDs MUST be bounded JSON-compatible values. Envelopes/manifests MUST reject unknown fields/kinds and invalid values; payload keys follow tool schemas; request IDs MUST be collision-safe.
#### Scenario: Unknown envelope
- **GIVEN** unknown envelope field/kind; **WHEN** validate; **THEN** fail closed.
#### Scenario: Valid payload
- **GIVEN** bounded envelope and schema-valid payload; **WHEN** validate; **THEN** admit unchanged.
#### Scenario: Live values
- **GIVEN** malicious getters/proxies; **WHEN** inspect; **THEN** compatibility/error handling only, no bounded-execution or sandbox claim.

### Requirement: Persistent tools-only RPC
Workers MUST retain closures; hosts MUST NOT re-import per call; non-tool RPC MUST fail.
#### Scenario: Closure persistence
- **GIVEN** stateful tool called twice; **WHEN** second call; **THEN** prior state observed.
#### Scenario: RPC surface
- **GIVEN** non-tool operation; **WHEN** submit; **THEN** reject without state change.

### Requirement: Collision-safe loader admission
A loader owns startup/import only. After identity, security, and collision checks, ownership MUST hand off once to the host registry; no credentialed transfer API exists.
#### Scenario: Collision
- **GIVEN** duplicate/cross-plugin identity; **WHEN** admit; **THEN** reject; siblings unaffected.
#### Scenario: Handoff
- **GIVEN** checks succeed; **WHEN** commit admission; **THEN** registry owns once; loader reuse rejected.

### Requirement: Import-deadline termination
On deadline, the host MUST request termination and remain pending until actual worker exit/final acknowledgement. Intermediate errors are diagnostic only; no earlier completion or cleanup.
#### Scenario: Pending termination
- **GIVEN** deadline expires; **WHEN** terminate; **THEN** no false completion.
#### Scenario: Intermediate error
- **GIVEN** error before exit; **WHEN** observe; **THEN** pending; diagnostics only.
#### Scenario: Final exit
- **GIVEN** exit acknowledgement; **WHEN** accept; **THEN** one terminal result; managed resources cleaned.

### Requirement: Quarantine without restart or replay
Failure MUST quarantine, settle every pending request exactly once, and clean managed resources, host listeners, state, and buffers; no descendant/native-I/O guarantee exists.
#### Scenario: Failure settlement
- **GIVEN** pending requests and failure; **WHEN** quarantine; **THEN** settle once; no restart/replay.
#### Scenario: Sibling isolation
- **GIVEN** healthy sibling; **WHEN** quarantine; **THEN** sibling state/work unchanged.
#### Scenario: Late duplicate
- **GIVEN** request settled; **WHEN** duplicate arrives; **THEN** ignore; no reopen/emission.

### Requirement: Observational invocation timeout
Timeout MUST return a bounded outcome while keeping the worker alive; it MUST NOT terminate, restart, replay, replace, or settle twice.
#### Scenario: Worker remains alive
- **GIVEN** invocation exceeds deadline; **WHEN** timeout; **THEN** worker/closures remain alive.
#### Scenario: Late outcome
- **GIVEN** timed-out invocation emits; **WHEN** receive; **THEN** cannot replace/duplicate timeout.

### Requirement: Fail-closed compatibility and explicit legacy fallback
Unestablished compatibility MUST refuse worker mode. If worker mode was explicitly requested, legacy fallback MUST also be explicit; no-opt-in loading remains legacy.
#### Scenario: Incompatible worker
- **GIVEN** compatibility unestablished and worker requested; **WHEN** evaluate; **THEN** refuse before admission.
#### Scenario: Explicit legacy fallback
- **GIVEN** unsupported worker and explicit legacy; **WHEN** load; **THEN** legacy; worker guarantees inapplicable.

### Requirement: Lifetime, cleanup, and ESM packaging
Loader owns startup/import; successful admission hands off once; shutdown, quarantine, or exit ends lifetime. Rejection/shutdown MUST clean managed resources, host listeners, requests, and buffers. Artifact MUST be deployable packaged ESM.
#### Scenario: Rejected startup
- **GIVEN** startup/admission rejects; **WHEN** cleanup; **THEN** no managed resource/listener/request/buffer; no descendant/native-I/O claim.
#### Scenario: Shutdown
- **GIVEN** authorized shutdown; **WHEN** complete; **THEN** stopped once; no revive/replay.
#### Scenario: ESM artifact
- **GIVEN** deployment package; **WHEN** inspect; **THEN** supported packaged ESM; no host re-import.

Implementation MUST test these scenarios. This phase performs no runtime, test, build, install, native-attempt, RDD, commit, or push operation.
