# Research: telemetry sink protection

```yaml
schema: gentle-ai.sdd-research/v1
revision: 2
change: telemetry-sink-protection
outcome: blocked
requested_source_classes:
  - documentation
admission:
  schema: gentle-ai.sdd-research-capability/v1
  status: denied
  observed_grants:
    documentation: []
    open-web: []
  used_grants: []
  reason: >
    This is the single re-entry of the selected research phase. A maintainer
    restoration notice was supplied, but the exact runtime capability
    declaration still contains empty documentation and open-web grants.
    The selected documentation research therefore remains denied before
    source access.
```

## Selected research intent

Collect implementation-relevant, source-backed guidance on data minimization;
request and response exclusion from logs and traces; retention and deletion
controls; legacy-data isolation; and safe error projection. Do not make legal
or jurisdictional claims. Prefer primary standards or vendor documentation.

The intended deliverable is an evidence-backed retention matrix for request
logs, usage, analytics, authorized comparison history, ordinary logs, traces,
and metrics. It must state assumptions and identify maintainer-confirmation
requirements.

## Re-entry admission result

Research admission is blocked before source access. The exact declared grants
are `documentation: []` and `open-web: []`; a maintainer notice does not itself
admit a source class. Therefore this revision contains no sources, excerpts,
validated claims, contradictions, freshness assessments, or evidence-backed
retention recommendations.

## Confirmed product choices — non-authoritative

The following are supplied product decisions, not research conclusions:

| Topic | Confirmed choice |
| --- | --- |
| Comparison prompts and responses | They may remain only as an explicitly authorized capability. |
| Existing sensitive rows | Isolate them as legacy data: prohibit new writes and routine readback. |
| Telemetry and readback | Retain only opaque IDs. |
| Usage errors | Preserve compatibility-safe `usage.errorMessage` text and add a safe error code/category. |
| Retention | Configure it independently for every sink/exporter. |

## Proposed matrix status

No proposed duration, payload rule, deletion mechanism, or sink-specific control
is admitted without the requested sources. The fixed product decisions constrain
the eventual matrix but are not research evidence. Every row remains blocked
pending admitted documentation evidence and maintainer confirmation.

| Data class | Evidence-backed proposed policy | Retention and deletion control | Maintainer confirmation required |
| --- | --- | --- | --- |
| Request logs | Blocked: no admitted source-backed minimization or payload-exclusion policy | Blocked | Yes: payload fields, sink, duration, deletion owner, and verification method. |
| Usage | Blocked: no admitted source-backed projection policy | Blocked | Yes: opaque-ID boundary, safe error code/category contract, exporter scope, duration, and deletion owner. |
| Analytics | Blocked: no admitted source-backed aggregation or payload-exclusion policy | Blocked | Yes: aggregation boundary, label/dimension policy, exporter scope, duration, and deletion owner. |
| Authorized comparison history | Blocked: no admitted source-backed authorization, isolation, or retention policy | Blocked | Yes: authorization mechanism, access boundary, duration, deletion owner, and legacy isolation procedure. |
| Ordinary logs | Blocked: no admitted source-backed log payload-exclusion policy | Blocked | Yes: payload fields, sink, duration, exporter scope, and deletion owner. |
| Traces | Blocked: no admitted source-backed trace attribute/exclusion policy | Blocked | Yes: attribute policy, collector/exporter, sampling interaction, duration, and deletion owner. |
| Metrics | Blocked: no admitted source-backed metric label/exclusion policy | Blocked | Yes: label policy, backend, duration, exporter scope, and deletion owner. |

## Recovery requirements

1. Supply a runtime capability declaration using
   `gentle-ai.sdd-research-capability/v1` with a non-empty `documentation`
   grant that specifically admits the source access required for this request.
   Supply a non-empty `open-web` grant only if open-web sources are requested.
2. Map every implementation claim and every retention-matrix recommendation to
   an admitted source ID.
3. Record source freshness, uncertainty, and any conflicts before proposing
   durations or deletion controls.
4. Obtain maintainer confirmation for every sink/exporter-specific retention,
   deletion, legacy-isolation, authorized-comparison, and error-projection
   policy after evidence is collected.

## Evidence sufficiency

The outcome is `blocked`. Selected research cannot satisfy proposal readiness
until source capability is admitted, primary documentation sources are
collected, every matrix policy is mapped to admitted evidence, and the listed
maintainer confirmations are recorded.
