# WP-00 Revision 22 Scenarios, Dependency DAG, and Work Units

> Normative companion to [the architecture design](../design.md). Mandatory reading with the full design set.

Source authority is tracked commit `f1ad14f6ae8037a52c705838f4bf1d2b9bac766b`. Current planning resolves `ask-on-risk` as an unchained `size:exception`, with no chain strategy. See [Non-Normative Provenance and Delivery Update](#non-normative-provenance-and-delivery-update) for the historical transition. This planning context grants no review, RDD, commit, push, PR, release, or delivery authority and bypasses no ordering, testing, verification, or RDD requirement. Estimates are authored production (P), fixture/manifest/generated (F), and test (T) changed-line lower–upper bounds. Every upper total is comfortably below 400; growth beyond a bound requires a new cohesive unit before apply.

## 1. Canonical dependency graph

The sole authority is `wp00-dag/v1` below. Unit-table predecessor cells and the rendered edge list are generated from this exact set; independent edits are invalid.

```json
{"schema":"wp00-dag/v1","units":["ADMIN-OVERVIEW","AUTH-ADMIN","AUTH-BIND-CORS","AUTH-CSRF","AUTH-LOGOUT","AUTH-OAUTH","AUTH-RUNTIME","CI-DASH","CI-ROOT","CLAIMS-FINAL","DIST-CLI","ERR-ACP","ERR-EXECUTION","ERR-HTTP-ADMIN-A","ERR-HTTP-ADMIN-B","ERR-HTTP-API-A","ERR-HTTP-API-B","ERR-HTTP-FOUNDATION","ERR-HTTP-SECURITY","ERR-MCP-DYNAMIC","ERR-MCP-SECURITY","ERR-MCP-SERVER","ERR-PLUGIN","EVID-CIRCUIT","EVID-COST","EVID-MODEL-CORE","EVID-MODEL-TRANSPORT","FINAL-INTEGRATION","GEN-DASH","HEALTH-CORE","HEALTH-HTTP","HEALTH-REGISTRY","HERM-CHILD","HERM-FS-T1","HERM-FS-T2","HERM-FS-T3","HERM-IMAGE","HERM-LOOP","HERM-RUNNER","LOG-BOOTSTRAP","LOG-CORE","LOG-OPERATIONS","LOG-ROOT-TOOLS","LOG-ROUTER","LOG-SERVICES","PUB-BUILD","PUB-OLD","SAFE-CORE","SCAN-AST","SCAN-BIN","SCAN-ROOT","SCAN-ROOT-ACTIONS","SCAN-ROOT-API","SCAN-ROOT-COMPOSE","SCAN-ROOT-DOCKER","SCAN-ROOT-INVENTORY","SCAN-ROOT-PACKAGE","SCAN-ROOT-SHELL","SYNC-TRUTH","TELEMETRY-COMPARISON","TELEMETRY-FINAL","TELEMETRY-REQUEST","UI-AUTH-EMBEDDED","UI-AUTH-REACT","UI-ERROR-EMBEDDED","UI-ERROR-REACT","UI-EVIDENCE-EMBEDDED","UI-EVIDENCE-REACT"],"edges":[["ADMIN-OVERVIEW","FINAL-INTEGRATION"],["AUTH-ADMIN","HEALTH-HTTP"],["AUTH-ADMIN","SYNC-TRUTH"],["AUTH-ADMIN","UI-AUTH-EMBEDDED"],["AUTH-ADMIN","UI-AUTH-REACT"],["AUTH-BIND-CORS","AUTH-OAUTH"],["AUTH-BIND-CORS","LOG-BOOTSTRAP"],["AUTH-CSRF","AUTH-ADMIN"],["AUTH-CSRF","LOG-BOOTSTRAP"],["AUTH-LOGOUT","FINAL-INTEGRATION"],["AUTH-OAUTH","AUTH-CSRF"],["AUTH-RUNTIME","AUTH-BIND-CORS"],["AUTH-RUNTIME","HEALTH-REGISTRY"],["CI-DASH","CLAIMS-FINAL"],["CI-ROOT","CI-DASH"],["CI-ROOT","FINAL-INTEGRATION"],["CLAIMS-FINAL","FINAL-INTEGRATION"],["DIST-CLI","CLAIMS-FINAL"],["DIST-CLI","SYNC-TRUTH"],["ERR-ACP","ERR-PLUGIN"],["ERR-ACP","TELEMETRY-FINAL"],["ERR-ACP","TELEMETRY-REQUEST"],["ERR-EXECUTION","TELEMETRY-FINAL"],["ERR-EXECUTION","TELEMETRY-REQUEST"],["ERR-HTTP-ADMIN-A","ERR-HTTP-ADMIN-B"],["ERR-HTTP-ADMIN-A","TELEMETRY-FINAL"],["ERR-HTTP-ADMIN-B","TELEMETRY-FINAL"],["ERR-HTTP-ADMIN-B","TELEMETRY-REQUEST"],["ERR-HTTP-API-A","ERR-HTTP-API-B"],["ERR-HTTP-API-A","TELEMETRY-FINAL"],["ERR-HTTP-API-B","TELEMETRY-FINAL"],["ERR-HTTP-API-B","TELEMETRY-REQUEST"],["ERR-HTTP-API-B","UI-ERROR-EMBEDDED"],["ERR-HTTP-API-B","UI-ERROR-REACT"],["ERR-HTTP-FOUNDATION","AUTH-BIND-CORS"],["ERR-HTTP-FOUNDATION","ERR-HTTP-ADMIN-A"],["ERR-HTTP-FOUNDATION","ERR-HTTP-API-A"],["ERR-HTTP-FOUNDATION","LOG-BOOTSTRAP"],["ERR-HTTP-FOUNDATION","TELEMETRY-FINAL"],["ERR-HTTP-SECURITY","LOG-OPERATIONS"],["ERR-HTTP-SECURITY","TELEMETRY-FINAL"],["ERR-MCP-DYNAMIC","ERR-MCP-SECURITY"],["ERR-MCP-DYNAMIC","TELEMETRY-FINAL"],["ERR-MCP-SECURITY","ERR-HTTP-SECURITY"],["ERR-MCP-SECURITY","LOG-OPERATIONS"],["ERR-MCP-SECURITY","TELEMETRY-FINAL"],["ERR-MCP-SERVER","ERR-ACP"],["ERR-MCP-SERVER","TELEMETRY-FINAL"],["ERR-MCP-SERVER","TELEMETRY-REQUEST"],["ERR-PLUGIN","TELEMETRY-FINAL"],["ERR-PLUGIN","TELEMETRY-REQUEST"],["EVID-CIRCUIT","ADMIN-OVERVIEW"],["EVID-CIRCUIT","EVID-MODEL-TRANSPORT"],["EVID-CIRCUIT","UI-EVIDENCE-EMBEDDED"],["EVID-CIRCUIT","UI-EVIDENCE-REACT"],["EVID-COST","ADMIN-OVERVIEW"],["EVID-COST","EVID-CIRCUIT"],["EVID-COST","UI-EVIDENCE-EMBEDDED"],["EVID-COST","UI-EVIDENCE-REACT"],["EVID-MODEL-CORE","EVID-MODEL-TRANSPORT"],["EVID-MODEL-CORE","LOG-ROUTER"],["EVID-MODEL-TRANSPORT","ADMIN-OVERVIEW"],["EVID-MODEL-TRANSPORT","UI-EVIDENCE-EMBEDDED"],["EVID-MODEL-TRANSPORT","UI-EVIDENCE-REACT"],["GEN-DASH","CI-DASH"],["GEN-DASH","CLAIMS-FINAL"],["HEALTH-CORE","HEALTH-HTTP"],["HEALTH-HTTP","ADMIN-OVERVIEW"],["HEALTH-HTTP","EVID-COST"],["HEALTH-HTTP","EVID-MODEL-TRANSPORT"],["HEALTH-HTTP","LOG-BOOTSTRAP"],["HEALTH-HTTP","UI-EVIDENCE-EMBEDDED"],["HEALTH-HTTP","UI-EVIDENCE-REACT"],["HEALTH-REGISTRY","DIST-CLI"],["HEALTH-REGISTRY","EVID-MODEL-CORE"],["HEALTH-REGISTRY","HEALTH-CORE"],["HERM-CHILD","HERM-IMAGE"],["HERM-FS-T1","HERM-FS-T2"],["HERM-FS-T2","HERM-FS-T3"],["HERM-FS-T3","HERM-IMAGE"],["HERM-IMAGE","CI-ROOT"],["HERM-LOOP","HERM-CHILD"],["HERM-RUNNER","HERM-FS-T1"],["HERM-RUNNER","HERM-LOOP"],["LOG-BOOTSTRAP","LOG-ROUTER"],["LOG-BOOTSTRAP","TELEMETRY-FINAL"],["LOG-CORE","LOG-BOOTSTRAP"],["LOG-CORE","TELEMETRY-FINAL"],["LOG-OPERATIONS","LOG-ROOT-TOOLS"],["LOG-OPERATIONS","TELEMETRY-FINAL"],["LOG-ROOT-TOOLS","TELEMETRY-FINAL"],["LOG-ROOT-TOOLS","TELEMETRY-REQUEST"],["LOG-ROUTER","LOG-SERVICES"],["LOG-ROUTER","TELEMETRY-COMPARISON"],["LOG-ROUTER","TELEMETRY-FINAL"],["LOG-SERVICES","LOG-OPERATIONS"],["LOG-SERVICES","TELEMETRY-FINAL"],["PUB-BUILD","PUB-OLD"],["PUB-OLD","GEN-DASH"],["SAFE-CORE","AUTH-RUNTIME"],["SAFE-CORE","ERR-EXECUTION"],["SAFE-CORE","ERR-HTTP-FOUNDATION"],["SAFE-CORE","ERR-MCP-DYNAMIC"],["SAFE-CORE","ERR-MCP-SERVER"],["SAFE-CORE","EVID-COST"],["SAFE-CORE","EVID-MODEL-CORE"],["SAFE-CORE","LOG-CORE"],["SCAN-AST","CI-ROOT"],["SCAN-BIN","SCAN-ROOT-API"],["SCAN-ROOT","DIST-CLI"],["SCAN-ROOT","HERM-RUNNER"],["SCAN-ROOT","PUB-BUILD"],["SCAN-ROOT","SCAN-AST"],["SCAN-ROOT-ACTIONS","SCAN-ROOT"],["SCAN-ROOT-API","SCAN-ROOT-ACTIONS"],["SCAN-ROOT-API","SCAN-ROOT-COMPOSE"],["SCAN-ROOT-API","SCAN-ROOT-DOCKER"],["SCAN-ROOT-API","SCAN-ROOT-INVENTORY"],["SCAN-ROOT-API","SCAN-ROOT-PACKAGE"],["SCAN-ROOT-API","SCAN-ROOT-SHELL"],["SCAN-ROOT-COMPOSE","SCAN-ROOT"],["SCAN-ROOT-DOCKER","SCAN-ROOT"],["SCAN-ROOT-INVENTORY","SCAN-ROOT"],["SCAN-ROOT-PACKAGE","SCAN-ROOT"],["SCAN-ROOT-SHELL","SCAN-ROOT"],["SYNC-TRUTH","CLAIMS-FINAL"],["TELEMETRY-COMPARISON","TELEMETRY-FINAL"],["TELEMETRY-FINAL","FINAL-INTEGRATION"],["TELEMETRY-REQUEST","TELEMETRY-COMPARISON"],["UI-AUTH-EMBEDDED","AUTH-LOGOUT"],["UI-AUTH-EMBEDDED","GEN-DASH"],["UI-AUTH-EMBEDDED","UI-ERROR-EMBEDDED"],["UI-AUTH-REACT","AUTH-LOGOUT"],["UI-AUTH-REACT","GEN-DASH"],["UI-ERROR-EMBEDDED","GEN-DASH"],["UI-ERROR-EMBEDDED","UI-EVIDENCE-EMBEDDED"],["UI-ERROR-REACT","GEN-DASH"],["UI-EVIDENCE-EMBEDDED","GEN-DASH"],["UI-EVIDENCE-REACT","GEN-DASH"]],"topologicalBatches":[["SAFE-CORE","SCAN-BIN"],["AUTH-RUNTIME","ERR-EXECUTION","ERR-HTTP-FOUNDATION","ERR-MCP-DYNAMIC","ERR-MCP-SERVER","LOG-CORE","SCAN-ROOT-API"],["AUTH-BIND-CORS","ERR-ACP","ERR-HTTP-ADMIN-A","ERR-HTTP-API-A","ERR-MCP-SECURITY","HEALTH-REGISTRY","SCAN-ROOT-ACTIONS","SCAN-ROOT-COMPOSE","SCAN-ROOT-DOCKER","SCAN-ROOT-INVENTORY","SCAN-ROOT-PACKAGE","SCAN-ROOT-SHELL"],["AUTH-OAUTH","ERR-HTTP-ADMIN-B","ERR-HTTP-API-B","ERR-HTTP-SECURITY","ERR-PLUGIN","EVID-MODEL-CORE","HEALTH-CORE","SCAN-ROOT"],["AUTH-CSRF","DIST-CLI","HERM-RUNNER","PUB-BUILD","SCAN-AST","UI-ERROR-REACT"],["AUTH-ADMIN","HERM-FS-T1","HERM-LOOP","PUB-OLD"],["HEALTH-HTTP","HERM-CHILD","HERM-FS-T2","SYNC-TRUTH","UI-AUTH-EMBEDDED","UI-AUTH-REACT"],["AUTH-LOGOUT","EVID-COST","HERM-FS-T3","LOG-BOOTSTRAP","UI-ERROR-EMBEDDED"],["EVID-CIRCUIT","HERM-IMAGE","LOG-ROUTER"],["CI-ROOT","EVID-MODEL-TRANSPORT","LOG-SERVICES"],["ADMIN-OVERVIEW","LOG-OPERATIONS","UI-EVIDENCE-EMBEDDED","UI-EVIDENCE-REACT"],["GEN-DASH","LOG-ROOT-TOOLS"],["CI-DASH","TELEMETRY-REQUEST"],["CLAIMS-FINAL","TELEMETRY-COMPARISON"],["TELEMETRY-FINAL"],["FINAL-INTEGRATION"]]}
```

Generated complete rendering (139 edges):
```text
ADMIN-OVERVIEW -> FINAL-INTEGRATION
AUTH-ADMIN -> HEALTH-HTTP
AUTH-ADMIN -> SYNC-TRUTH
AUTH-ADMIN -> UI-AUTH-EMBEDDED
AUTH-ADMIN -> UI-AUTH-REACT
AUTH-BIND-CORS -> AUTH-OAUTH
AUTH-BIND-CORS -> LOG-BOOTSTRAP
AUTH-CSRF -> AUTH-ADMIN
AUTH-CSRF -> LOG-BOOTSTRAP
AUTH-LOGOUT -> FINAL-INTEGRATION
AUTH-OAUTH -> AUTH-CSRF
AUTH-RUNTIME -> AUTH-BIND-CORS
AUTH-RUNTIME -> HEALTH-REGISTRY
CI-DASH -> CLAIMS-FINAL
CI-ROOT -> CI-DASH
CI-ROOT -> FINAL-INTEGRATION
CLAIMS-FINAL -> FINAL-INTEGRATION
DIST-CLI -> CLAIMS-FINAL
DIST-CLI -> SYNC-TRUTH
ERR-ACP -> ERR-PLUGIN
ERR-ACP -> TELEMETRY-FINAL
ERR-ACP -> TELEMETRY-REQUEST
ERR-EXECUTION -> TELEMETRY-FINAL
ERR-EXECUTION -> TELEMETRY-REQUEST
ERR-HTTP-ADMIN-A -> ERR-HTTP-ADMIN-B
ERR-HTTP-ADMIN-A -> TELEMETRY-FINAL
ERR-HTTP-ADMIN-B -> TELEMETRY-FINAL
ERR-HTTP-ADMIN-B -> TELEMETRY-REQUEST
ERR-HTTP-API-A -> ERR-HTTP-API-B
ERR-HTTP-API-A -> TELEMETRY-FINAL
ERR-HTTP-API-B -> TELEMETRY-FINAL
ERR-HTTP-API-B -> TELEMETRY-REQUEST
ERR-HTTP-API-B -> UI-ERROR-EMBEDDED
ERR-HTTP-API-B -> UI-ERROR-REACT
ERR-HTTP-FOUNDATION -> AUTH-BIND-CORS
ERR-HTTP-FOUNDATION -> ERR-HTTP-ADMIN-A
ERR-HTTP-FOUNDATION -> ERR-HTTP-API-A
ERR-HTTP-FOUNDATION -> LOG-BOOTSTRAP
ERR-HTTP-FOUNDATION -> TELEMETRY-FINAL
ERR-HTTP-SECURITY -> LOG-OPERATIONS
ERR-HTTP-SECURITY -> TELEMETRY-FINAL
ERR-MCP-DYNAMIC -> ERR-MCP-SECURITY
ERR-MCP-DYNAMIC -> TELEMETRY-FINAL
ERR-MCP-SECURITY -> ERR-HTTP-SECURITY
ERR-MCP-SECURITY -> LOG-OPERATIONS
ERR-MCP-SECURITY -> TELEMETRY-FINAL
ERR-MCP-SERVER -> ERR-ACP
ERR-MCP-SERVER -> TELEMETRY-FINAL
ERR-MCP-SERVER -> TELEMETRY-REQUEST
ERR-PLUGIN -> TELEMETRY-FINAL
ERR-PLUGIN -> TELEMETRY-REQUEST
EVID-CIRCUIT -> ADMIN-OVERVIEW
EVID-CIRCUIT -> EVID-MODEL-TRANSPORT
EVID-CIRCUIT -> UI-EVIDENCE-EMBEDDED
EVID-CIRCUIT -> UI-EVIDENCE-REACT
EVID-COST -> ADMIN-OVERVIEW
EVID-COST -> EVID-CIRCUIT
EVID-COST -> UI-EVIDENCE-EMBEDDED
EVID-COST -> UI-EVIDENCE-REACT
EVID-MODEL-CORE -> EVID-MODEL-TRANSPORT
EVID-MODEL-CORE -> LOG-ROUTER
EVID-MODEL-TRANSPORT -> ADMIN-OVERVIEW
EVID-MODEL-TRANSPORT -> UI-EVIDENCE-EMBEDDED
EVID-MODEL-TRANSPORT -> UI-EVIDENCE-REACT
GEN-DASH -> CI-DASH
GEN-DASH -> CLAIMS-FINAL
HEALTH-CORE -> HEALTH-HTTP
HEALTH-HTTP -> ADMIN-OVERVIEW
HEALTH-HTTP -> EVID-COST
HEALTH-HTTP -> EVID-MODEL-TRANSPORT
HEALTH-HTTP -> LOG-BOOTSTRAP
HEALTH-HTTP -> UI-EVIDENCE-EMBEDDED
HEALTH-HTTP -> UI-EVIDENCE-REACT
HEALTH-REGISTRY -> DIST-CLI
HEALTH-REGISTRY -> EVID-MODEL-CORE
HEALTH-REGISTRY -> HEALTH-CORE
HERM-CHILD -> HERM-IMAGE
HERM-FS-T1 -> HERM-FS-T2
HERM-FS-T2 -> HERM-FS-T3
HERM-FS-T3 -> HERM-IMAGE
HERM-IMAGE -> CI-ROOT
HERM-LOOP -> HERM-CHILD
HERM-RUNNER -> HERM-FS-T1
HERM-RUNNER -> HERM-LOOP
LOG-BOOTSTRAP -> LOG-ROUTER
LOG-BOOTSTRAP -> TELEMETRY-FINAL
LOG-CORE -> LOG-BOOTSTRAP
LOG-CORE -> TELEMETRY-FINAL
LOG-OPERATIONS -> LOG-ROOT-TOOLS
LOG-OPERATIONS -> TELEMETRY-FINAL
LOG-ROOT-TOOLS -> TELEMETRY-FINAL
LOG-ROOT-TOOLS -> TELEMETRY-REQUEST
LOG-ROUTER -> LOG-SERVICES
LOG-ROUTER -> TELEMETRY-COMPARISON
LOG-ROUTER -> TELEMETRY-FINAL
LOG-SERVICES -> LOG-OPERATIONS
LOG-SERVICES -> TELEMETRY-FINAL
PUB-BUILD -> PUB-OLD
PUB-OLD -> GEN-DASH
SAFE-CORE -> AUTH-RUNTIME
SAFE-CORE -> ERR-EXECUTION
SAFE-CORE -> ERR-HTTP-FOUNDATION
SAFE-CORE -> ERR-MCP-DYNAMIC
SAFE-CORE -> ERR-MCP-SERVER
SAFE-CORE -> EVID-COST
SAFE-CORE -> EVID-MODEL-CORE
SAFE-CORE -> LOG-CORE
SCAN-AST -> CI-ROOT
SCAN-BIN -> SCAN-ROOT-API
SCAN-ROOT-API -> SCAN-ROOT-ACTIONS
SCAN-ROOT-API -> SCAN-ROOT-COMPOSE
SCAN-ROOT-API -> SCAN-ROOT-DOCKER
SCAN-ROOT-API -> SCAN-ROOT-INVENTORY
SCAN-ROOT-API -> SCAN-ROOT-PACKAGE
SCAN-ROOT-API -> SCAN-ROOT-SHELL
SCAN-ROOT-ACTIONS -> SCAN-ROOT
SCAN-ROOT-COMPOSE -> SCAN-ROOT
SCAN-ROOT-DOCKER -> SCAN-ROOT
SCAN-ROOT-INVENTORY -> SCAN-ROOT
SCAN-ROOT-PACKAGE -> SCAN-ROOT
SCAN-ROOT-SHELL -> SCAN-ROOT
SCAN-ROOT -> DIST-CLI
SCAN-ROOT -> HERM-RUNNER
SCAN-ROOT -> PUB-BUILD
SCAN-ROOT -> SCAN-AST
SYNC-TRUTH -> CLAIMS-FINAL
TELEMETRY-COMPARISON -> TELEMETRY-FINAL
TELEMETRY-FINAL -> FINAL-INTEGRATION
TELEMETRY-REQUEST -> TELEMETRY-COMPARISON
UI-AUTH-EMBEDDED -> AUTH-LOGOUT
UI-AUTH-EMBEDDED -> GEN-DASH
UI-AUTH-EMBEDDED -> UI-ERROR-EMBEDDED
UI-AUTH-REACT -> AUTH-LOGOUT
UI-AUTH-REACT -> GEN-DASH
UI-ERROR-EMBEDDED -> GEN-DASH
UI-ERROR-EMBEDDED -> UI-EVIDENCE-EMBEDDED
UI-ERROR-REACT -> GEN-DASH
UI-EVIDENCE-EMBEDDED -> GEN-DASH
UI-EVIDENCE-REACT -> GEN-DASH
```

Generated topological batches (16 waves; each unit appears once):
```text
W01: SAFE-CORE, SCAN-BIN
W02: AUTH-RUNTIME, ERR-EXECUTION, ERR-HTTP-FOUNDATION, ERR-MCP-DYNAMIC, ERR-MCP-SERVER, LOG-CORE, SCAN-ROOT-API
W03: AUTH-BIND-CORS, ERR-ACP, ERR-HTTP-ADMIN-A, ERR-HTTP-API-A, ERR-MCP-SECURITY, HEALTH-REGISTRY, SCAN-ROOT-ACTIONS, SCAN-ROOT-COMPOSE, SCAN-ROOT-DOCKER, SCAN-ROOT-INVENTORY, SCAN-ROOT-PACKAGE, SCAN-ROOT-SHELL
W04: AUTH-OAUTH, ERR-HTTP-ADMIN-B, ERR-HTTP-API-B, ERR-HTTP-SECURITY, ERR-PLUGIN, EVID-MODEL-CORE, HEALTH-CORE, SCAN-ROOT
W05: AUTH-CSRF, DIST-CLI, HERM-RUNNER, PUB-BUILD, SCAN-AST, UI-ERROR-REACT
W06: AUTH-ADMIN, HERM-FS-T1, HERM-LOOP, PUB-OLD
W07: HEALTH-HTTP, HERM-CHILD, HERM-FS-T2, SYNC-TRUTH, UI-AUTH-EMBEDDED, UI-AUTH-REACT
W08: AUTH-LOGOUT, EVID-COST, HERM-FS-T3, LOG-BOOTSTRAP, UI-ERROR-EMBEDDED
W09: EVID-CIRCUIT, HERM-IMAGE, LOG-ROUTER
W10: CI-ROOT, EVID-MODEL-TRANSPORT, LOG-SERVICES
W11: ADMIN-OVERVIEW, LOG-OPERATIONS, UI-EVIDENCE-EMBEDDED, UI-EVIDENCE-REACT
W12: GEN-DASH, LOG-ROOT-TOOLS
W13: CI-DASH, TELEMETRY-REQUEST
W14: CLAIMS-FINAL, TELEMETRY-COMPARISON
W15: TELEMETRY-FINAL
W16: FINAL-INTEGRATION


## 2. Concrete work-unit ledger

| Unit; predecessors | Exact edit ownership | P / F / T; max | Rollback and RDD gate |
|---|---|---:|---|
| SAFE-CORE; — | create `src/core/safe-error.ts,src/core/safe-operation.ts,src/core/safe-telemetry.ts`; create HTTP adapter | 90–120 / 10–20 / 90–130; 270 | suppress failure; RED fixtures |
| LOG-CORE; SAFE-CORE | `src/core/logger.ts:createLogger,logger,childLogger` only | 40–70 / 10–20 / 70–100; 190 | stderr/suppress; scanner |
| ERR-HTTP-FOUNDATION; SAFE-CORE | exact ledger paths/sections assigned to unit | 80–110 / 20–30 / 90–130; 270 | safe responder |
| ERR-HTTP-ADMIN-A; ERR-HTTP-FOUNDATION | exact ledger paths assigned | 80–110 / 20–30 / 90–130; 270 | constant admin errors |
| ERR-HTTP-ADMIN-B; ERR-HTTP-ADMIN-A | exact ledger paths assigned | 90–120 / 20–30 / 100–140; 290 | constant sync/admin |
| ERR-HTTP-API-A; ERR-HTTP-FOUNDATION | exact ledger paths assigned | 90–120 / 20–30 / 100–140; 290 | protocol shapes |
| ERR-HTTP-API-B; ERR-HTTP-API-A | exact ledger paths assigned | 90–120 / 20–30 / 100–140; 290 | storage/observability compatibility |
| ERR-MCP-DYNAMIC; SAFE-CORE | `mcp-builder/adapter.ts` runtime/result sections | 70–100 / 20–30 / 90–130; 260 | constant isError |
| ERR-MCP-SECURITY; ERR-MCP-DYNAMIC | `security/enforcer.ts:wrapHandlers` only | 50–80 / 20–30 / 80–120; 230 | MCP deny |
| ERR-HTTP-SECURITY; ERR-MCP-SECURITY | `security/enforcer.ts:securityProfileMiddleware` only | 40–70 / 15–25 / 70–110; 205 | HTTP deny |
| ERR-MCP-SERVER; SAFE-CORE | exact MCP server ledger paths | 90–120 / 20–30 / 100–140; 290 | constant result |
| ERR-ACP; ERR-MCP-SERVER | ACP server/translator; constants read-only | 60–90 / 20–30 / 90–130; 250 | exact numerics |
| ERR-PLUGIN; ERR-ACP | loader issue construction | 50–80 / 20–30 / 80–120; 230 | suppress import data |
| ERR-EXECUTION; SAFE-CORE | execution/streaming ledger paths | 80–110 / 20–30 / 90–130; 270 | SafeErrorRef |
| AUTH-RUNTIME; SAFE-CORE | create auth runtime/store types; config auth fields | 90–120 / 20–30 / 100–140; 290 | admin unavailable |
| AUTH-BIND-CORS; AUTH-RUNTIME,ERR-HTTP-FOUNDATION | bind/proxy helper; `http-app.ts` CORS and bind sections | 90–120 / 20–30 / 100–140; 290 | loopback/refuse |
| AUTH-OAUTH; AUTH-BIND-CORS | `public.ts` OAuth ranges; github-oauth constructors | 90–120 / 20–30 / 100–140; 290 | OAuth off |
| AUTH-CSRF; AUTH-OAUTH | create CSRF store/middleware; `http-app.ts` cookie-unsafe section | 90–120 / 20–30 / 110–150; 300 | deny unsafe |
| AUTH-ADMIN; AUTH-CSRF | `admin.ts`; auth-config named range | 60–90 / 15–25 / 90–130; 245 | 503/401 |
| UI-AUTH-REACT; AUTH-ADMIN | exact React auth paths | 70–100 / 20–30 / 90–130; 260 | login unavailable |
| UI-AUTH-EMBEDDED; AUTH-ADMIN | embedded dashboard auth named ranges | 60–90 / 20–30 / 80–120; 240 | login unavailable |
| AUTH-LOGOUT; UI-AUTH-REACT,UI-AUTH-EMBEDDED | logout server range then UI logout call sites only | 60–90 / 20–30 / 90–130; 250 | clear cookie |
| HEALTH-REGISTRY; AUTH-RUNTIME | router register/freeze; createAllAdapters/aliases; runtime-context post-local validation | 90–120 / 20–30 / 100–140; 290 | no listen |
| HEALTH-CORE; HEALTH-REGISTRY | create health snapshot/fence and evidence constructors | 110–140 / 20–30 / 120–150; 320 | Unknown snapshot |
| HEALTH-HTTP; HEALTH-CORE,AUTH-ADMIN | public/admin health named sections and http injection | 70–100 / 20–30 / 90–130; 260 | no false green |
| EVID-COST; SAFE-CORE,HEALTH-HTTP | cost tracker, usage, admin cost range, MCP cost range | 70–100 / 20–30 / 90–130; 260 | Unknown |
| EVID-CIRCUIT; EVID-COST | circuit route/compat, admin/MCP circuit ranges | 60–90 / 20–30 / 90–130; 250 | Unknown |
| EVID-MODEL-CORE; HEALTH-REGISTRY,SAFE-CORE | model-cache timestamps; Router evidence getters | 90–120 / 20–30 / 100–140; 290 | Unknown |
| EVID-MODEL-TRANSPORT; EVID-MODEL-CORE,HEALTH-HTTP,EVID-CIRCUIT | metadata/MCP/admin model named sections | 80–110 / 20–30 / 100–140; 280 | additive old fields |
| ADMIN-OVERVIEW; EVID-MODEL-TRANSPORT,EVID-COST,EVID-CIRCUIT,HEALTH-HTTP | remaining overview/providers/sessions/model-router response assembly in admin/dashboard.ts | 50–80 / 20–30 / 80–120; 230 | preserve legacy fields/Unknown additions |
| UI-EVIDENCE-REACT; EVID-COST,EVID-CIRCUIT,EVID-MODEL-TRANSPORT,HEALTH-HTTP | exact React evidence paths/types | 80–110 / 20–30 / 100–140; 280 | Unknown |
| UI-ERROR-REACT; ERR-HTTP-API-B | Groups/Settings/WiringSprint error rendering | 40–70 / 20–30 / 70–110; 210 | constant copy |
| UI-ERROR-EMBEDDED; UI-AUTH-EMBEDDED,ERR-HTTP-API-B | embedded error/toast ranges | 50–80 / 20–30 / 80–120; 230 | constant copy |
| UI-EVIDENCE-EMBEDDED; EVID-COST,EVID-CIRCUIT,EVID-MODEL-TRANSPORT,HEALTH-HTTP,UI-ERROR-EMBEDDED | embedded evidence ranges | 70–100 / 20–30 / 90–130; 260 | Unknown |
| LOG-BOOTSTRAP; LOG-CORE,ERR-HTTP-FOUNDATION,AUTH-BIND-CORS,AUTH-CSRF,HEALTH-HTTP | exact LOG-BOOTSTRAP paths, logging sections only | 80–110 / 20–30 / 90–130; 270 | suppress |
| LOG-ROUTER; EVID-MODEL-CORE,LOG-BOOTSTRAP | exact LOG-ROUTER paths; comparison logging only | 80–110 / 20–30 / 90–130; 270 | suppress |
| LOG-SERVICES; LOG-ROUTER | exact LOG-SERVICES paths | 70–100 / 20–30 / 90–130; 260 | suppress |
| LOG-OPERATIONS; ERR-MCP-SECURITY,ERR-HTTP-SECURITY,LOG-SERVICES | exact LOG-OPERATIONS paths | 90–120 / 20–30 / 100–140; 290 | constant instructions |
| LOG-ROOT-TOOLS; LOG-OPERATIONS | two root pageindex scripts | 30–50 / 15–25 / 60–90; 165 | live-only |
| TELEMETRY-REQUEST; ERR-HTTP-ADMIN-B,ERR-HTTP-API-B,ERR-MCP-SERVER,ERR-ACP,ERR-PLUGIN,ERR-EXECUTION,LOG-ROOT-TOOLS | logging/analytics schemas/writer/reader | 80–110 / 20–30 / 100–140; 280 | NULL/code |
| TELEMETRY-COMPARISON; TELEMETRY-REQUEST,LOG-ROUTER | comparison durable fields only | 50–80 / 20–30 / 80–120; 230 | safe code |
| TELEMETRY-FINAL; TELEMETRY-COMPARISON,ERR-HTTP-FOUNDATION,ERR-HTTP-ADMIN-A,ERR-HTTP-ADMIN-B,ERR-HTTP-API-A,ERR-HTTP-API-B,ERR-MCP-DYNAMIC,ERR-MCP-SECURITY,ERR-HTTP-SECURITY,ERR-MCP-SERVER,ERR-ACP,ERR-PLUGIN,ERR-EXECUTION,LOG-CORE,LOG-BOOTSTRAP,LOG-ROUTER,LOG-SERVICES,LOG-OPERATIONS,LOG-ROOT-TOOLS | canary and zero-unowned-sink integration only | 10–30 / 40–60 / 130–170; 260 | gate red |
| SCAN-BIN; — | paths codec/JCS/hash/binding | 90–120 / 50–70 / 100–140; 330 | scanner red |
| SCAN-ROOT-API; SCAN-BIN | closed input/result/diagnostic API and parser registry | 50-70 / 40-60 / 80-110; 260 | API red |
| SCAN-ROOT-INVENTORY; SCAN-ROOT-API | Git/untracked inventory, executable classification, special files, symlink containment | 80-110 / 60-80 / 100-130; 320 | inventory red |
| SCAN-ROOT-PACKAGE; SCAN-ROOT-API | strict package/devcontainer JSON roots with duplicate-key rejection | 60-80 / 50-70 / 80-110; 260 | package red |
| SCAN-ROOT-SHELL; SCAN-ROOT-API | bounded lexical shell grammar; dynamic/indirect constructs reject | 80-110 / 60-80 / 110-140; 330 | shell red |
| SCAN-ROOT-ACTIONS; SCAN-ROOT-API | Actions jobs/steps execution subset; YAML aliases/tags/merges reject | 80-110 / 60-80 / 110-140; 330 | Actions red |
| SCAN-ROOT-DOCKER; SCAN-ROOT-API | Dockerfile shell/JSON execution forms and directives | 80-110 / 60-80 / 110-140; 330 | Dockerfile red |
| SCAN-ROOT-COMPOSE; SCAN-ROOT-API | Compose services/build/command/mount/environment subset | 80-110 / 60-80 / 110-140; 330 | Compose red |
| SCAN-ROOT; SCAN-ROOT-INVENTORY,SCAN-ROOT-PACKAGE,SCAN-ROOT-SHELL,SCAN-ROOT-ACTIONS,SCAN-ROOT-DOCKER,SCAN-ROOT-COMPOSE | generated/root/devcontainer dispatch, manifest assembly, zero-unparsed-root integration | 50-70 / 60-80 / 90-120; 270 | aggregate scanner red |
| SCAN-AST; SCAN-ROOT | TS 5.9.3 resolver/signatures/suppressions | 100–130 / 50–70 / 110–150; 350 | scanner red |
| HERM-RUNNER; SCAN-ROOT | bootstrap sole entry, JS guards, discovery/teardown | 100–130 / 40–60 / 110–150; 340 | tests red |
| HERM-LOOP; HERM-RUNNER | loopback registry/IPC | 60–90 / 30–50 / 90–130; 270 | listeners denied |
| HERM-CHILD; HERM-LOOP | fixture-child admission | 60–90 / 40–60 / 90–130; 280 | child denied |
| HERM-FS-T1; HERM-RUNNER | exact T1 paths from execution manifest | 50–80 / 20–30 / 100–140; 250 | tests red |
| HERM-FS-T2; HERM-FS-T1 | exact T2 paths from execution manifest | 60–90 / 20–30 / 110–150; 270 | tests red |
| HERM-FS-T3; HERM-FS-T2 | exact T3 paths from execution manifest | 60–90 / 20–30 / 110–150; 270 | tests red |
| HERM-IMAGE; HERM-CHILD,HERM-FS-T3 | create candidate-root `Dockerfile.test`, ignore, preflight; precedes CI-ROOT | 70–100 / 30–50 / 90–130; 340 | image unavailable |
| CI-ROOT; HERM-IMAGE,SCAN-AST | root CI job and ci-hermetic script | 30–50 / 20–30 / 70–100; 180 | CI red |
| PUB-BUILD; SCAN-ROOT | package/tsup/temp build/verifier/manifest | 70–100 / 30–50 / 90–130; 280 | publication disabled |
| PUB-OLD; PUB-BUILD | delete six enumerated dist-old files; assertion | 0–10 / 20–30 / 60–90; 130 | no old entry |
| DIST-CLI; HEALTH-REGISTRY,SCAN-ROOT | adapter/alias + Docker/Compose CLI claims | 60–90 / 20–30 / 90–130; 250 | unavailable |
| SYNC-TRUTH; DIST-CLI,AUTH-ADMIN | startup sync assertion and admin explicit action | 30–50 / 20–30 / 70–100; 180 | auto-sync off |
| GEN-DASH; UI-AUTH-REACT,UI-AUTH-EMBEDDED,UI-ERROR-REACT,UI-ERROR-EMBEDDED,UI-EVIDENCE-REACT,UI-EVIDENCE-EMBEDDED,PUB-OLD | regenerate/readback index/assets, hash static SVG inputs | 30–50 / 70–100 / 80–120; 270 | assets unpublished |
| CI-DASH; CI-ROOT,GEN-DASH | read-only grouped --static-source/--static-built/--static-tracked triple validation; owns DASH-CI IDs | 20–40 / 20–30 / 70–100; 170 | dashboard gate red |
| CLAIMS-FINAL; CI-DASH,DIST-CLI,SYNC-TRUTH,GEN-DASH | README, README.es, final generated-byte claim verifier | 40–70 / 20–30 / 80–120; 220 | remove claims |
| FINAL-INTEGRATION; CI-ROOT,TELEMETRY-FINAL,CLAIMS-FINAL,AUTH-LOGOUT,ADMIN-OVERVIEW | orchestration tests only, no production symbols | 10–30 / 30–50 / 130–170; 250 | REQ-00 fail-closed |

## 3. Unique scenario ownership and requirement traceability

| Owner | Exclusive scenario IDs | Preconditions / requirements |
|---|---|---|
| ERR-HTTP-FOUNDATION | SAFE-HF-01..08 | SAFE-CORE; auth/budget/rate/body |
| ERR-HTTP-ADMIN-A | SAFE-HA-01..10 | foundation; NOT_CONFIGURED 500/404 |
| ERR-HTTP-ADMIN-B | SAFE-HB-01..14 | admin-A; sync INVALID_JSON/MISSING_CREDENTIALS/INTERNAL_ERROR |
| ERR-HTTP-API-A | SAFE-HC-01..12 | OpenAI/Anthropic exact envelopes |
| ERR-HTTP-API-B | SAFE-HD-01..14 | storage 403 and observability INVALID_PARAMS |
| ERR-MCP-DYNAMIC | MCP-DYN-01..09 | raw tool/plugin/error canaries |
| ERR-MCP-SECURITY | MCP-SEC-01..06 | deny/rate |
| ERR-MCP-SERVER | MCP-SRV-01..10 | handler failures |
| ERR-ACP | ACP-01..10 | every exact numeric code |
| ERR-PLUGIN | PLUGIN-01..08 | all four loader codes |
| ERR-EXECUTION | EXEC-01..08 | streaming/nonstream failure |
| AUTH-BIND-CORS | HTTP-BIND-01..06; CORS-01..10 | REQ-HTTP-01; PATCH/header/preflight |
| AUTH-OAUTH | OAUTH-01..12; ORIGIN-01..18 | canonical origin/state/allowlist/no query JWT |
| AUTH-CSRF | CSRF-01..16 | cookie-first selection, sibling/missing/duplicate/malformed/stale/rotation |
| AUTH-ADMIN | ADMIN-01..10 | missing/invalid/precedence/middleware |
| UI-AUTH-REACT | AUTH-REACT-01..08 | cookie/CSRF no storage |
| UI-AUTH-EMBEDDED | AUTH-EMBED-01..08 | cookie/CSRF no storage |
| AUTH-LOGOUT | LOGOUT-01..10 | valid/stale/exact clear/401/403 retry |
| HEALTH-REGISTRY | HEALTH-REG-01..10 | post-local freeze/duplicate/required/late register |
| HEALTH-CORE | HEALTH-FENCE-01..14 | four hung, queued, TTL, late, cancel/no-abort, initial, all hung |
| HEALTH-HTTP | HEALTH-WIRE-01..10 | same snapshot ID/no false green |
| EVID-COST | COST-01..10 | missing/known zero/stale |
| EVID-CIRCUIT | CIRCUIT-01..10 | missing vs known CLOSED |
| EVID-MODEL-CORE | MODEL-CORE-01..12 | attempt-state total mapping |
| EVID-MODEL-TRANSPORT | MODEL-XPORT-01..14 | cache/router/HTTP/admin/MCP old/new |
| ADMIN-OVERVIEW | ADMIN-WIRE-01..08 | exact old/new overview/providers/sessions/router fixtures |
| UI-EVIDENCE-REACT | EVID-REACT-01..10 | old server Unknown |
| UI-EVIDENCE-EMBEDDED | EVID-EMBED-01..10 | old server Unknown |
| TELEMETRY-FINAL | TELEMETRY-CANARY-01..08 | all sink migrations; log/trace/error/audit/durable |
| SCAN-BIN | SCAN-BIN-01..14 | binary/JCS/hash/symlink |
| SCAN-ROOT-API | SCAN-ROOT-01..02 | deterministic discriminated API, stable diagnostics |
| SCAN-ROOT-INVENTORY | SCAN-ROOT-03..04 | Git/untracked modes, special files, symlink containment |
| SCAN-ROOT-PACKAGE | SCAN-ROOT-05..06 | strict package/devcontainer JSON roots |
| SCAN-ROOT-SHELL | SCAN-ROOT-07..08 | required bounded shell grammar and dynamic rejection |
| SCAN-ROOT-ACTIONS | SCAN-ROOT-09..10 | Actions execution fields and unsupported YAML rejection |
| SCAN-ROOT-DOCKER | SCAN-ROOT-11..12 | Dockerfile shell/JSON forms and dynamic rejection |
| SCAN-ROOT-COMPOSE | SCAN-ROOT-13..14 | Compose execution fields and unsupported YAML rejection |
| SCAN-ROOT | SCAN-ROOT-15..16 | generated/devcontainer dispatch and zero-unparsed-root integration |
| SCAN-AST | SCAN-AST-01..18 | imports/reexports/alias/wrapper/callback/factory/spread/fail/suppress |
| HERM-RUNNER | HERM-ROOT-01..12 | sole bootstrap/discovery/teardown/signals |
| HERM-LOOP | HERM-LOOP-01..10 | registry positive/negative/leak |
| HERM-CHILD | HERM-CHILD-01..12 | admitted child positive/negative |
| HERM-FS-T1 | HERM-FS-T1-01..06 | exact group 1 |
| HERM-FS-T2 | HERM-FS-T2-01..08 | exact group 2 |
| HERM-FS-T3 | HERM-FS-T3-01..08 | exact group 3 |
| HERM-IMAGE | HERM-IMG-01..12 | network none/read-only/tmpfs/nonroot/no CLI/mount |
| CI-ROOT | HERM-CI-01..10 | exact root command and clean tree |
| PUB-BUILD | PUB-BUILD-01..12 | files/main/bin/module/exports/tsup/pack |
| PUB-OLD | PUB-OLD-01..07 | six deletions plus no root edge |
| DIST-CLI | DIST-CLI-01..10 | required failure/optional qualification/agy-gemini |
| SYNC-TRUTH | SYNC-START-01..05 | REQ-SYNC-01 |
| GEN-DASH | GEN-DASH-01..10 | index/assets/static SVG/readback |
| CI-DASH | DASH-CI-01..10 | Vitest/temp build/stale/extraneous/missing/clean |
| CLAIMS-FINAL | CLAIM-01..10 | both dashboards, README/README.es, final docs bytes |
| FINAL-INTEGRATION | ROLLBACK-00; INTEGRATION-01..08 | all seven requirements and final REQ-00 rollback |

## 4. Shared-symbol serialization

- `src/security/enforcer.ts`: ERR-MCP-SECURITY -> ERR-HTTP-SECURITY -> LOG-OPERATIONS.
- `src/server/http-app.ts`: ERR-HTTP-FOUNDATION -> AUTH-BIND-CORS -> AUTH-CSRF -> HEALTH-HTTP -> LOG-BOOTSTRAP.
- `src/server/routes/public.ts`: AUTH-OAUTH -> AUTH-ADMIN -> HEALTH-HTTP.
- `src/server/routes/admin/dashboard.ts`: HEALTH-HTTP -> EVID-COST -> EVID-CIRCUIT -> EVID-MODEL-TRANSPORT -> ADMIN-OVERVIEW.
- `src/server/dashboard.ts`: UI-AUTH-EMBEDDED -> UI-ERROR-EMBEDDED -> UI-EVIDENCE-EMBEDDED -> GEN-DASH.
- `src/core/types.ts,src/core/config.ts`: AUTH-RUNTIME -> HEALTH-REGISTRY.
- `src/core/router.ts`: HEALTH-REGISTRY -> EVID-MODEL-CORE -> LOG-ROUTER.
- `src/adapters/index.ts,src/core/provider-aliases.ts`: HEALTH-REGISTRY -> DIST-CLI.
- `src/core/evidence.ts`: HEALTH-CORE owns definitions; evidence units consume only.
- `.github/workflows/ci.yml`: CI-ROOT -> CI-DASH.
- `dashboard/public/favicon.svg,dashboard/public/icons.svg` and generated `docs/index.html,docs/assets/**,docs/favicon.svg,docs/icons.svg`: GEN-DASH owns source/build/output manifest and regeneration; CI-DASH reads only; CLAIMS-FINAL reads final tracked bytes.

Reachability audit: HEALTH-REGISTRY reaches EVID-MODEL-CORE directly and LOG-ROUTER through EVID-MODEL-CORE; HEALTH-REGISTRY reaches DIST-CLI directly. Consequently neither EVID-MODEL-CORE nor DIST-CLI can enter a batch before HEALTH-REGISTRY, and LOG-ROUTER cannot enter before EVID-MODEL-CORE. CI-ROOT remains before CI-DASH.

Each unit writes behavior-first RED tests, runs focused tests plus scanner, normalizes before freeze, and obtains candidate-bound RDD evidence. Generated bytes remain in snapshot identity but do not hide authored line budget.

## 5. Current-main impact reconciliation

Revision 22 source-refresh proof established 61 unique units and 127 unique edges before the approved SCAN-ROOT split. The current mechanically recomputed graph has exactly 68 unique units, 139 unique edges, remains acyclic, and retains 16 stored-equal topological waves. Symbol ownership: DIST-CLI solely owns timeout/model declaration changes in `src/core/constants.ts`, `src/adapters/base-cli-adapter.ts`, `src/adapters/cli-claude.ts`, and `src/adapters/cli-opencode.ts`; AUTH-RUNTIME owns disjoint auth constants and precedes DIST-CLI transitively through HEALTH-REGISTRY. CI-ROOT solely edits the root CI job before CI-DASH. HERM-FS-T3 owns suite-root/StubAdapter setup sections in the six changed tests; DIST-CLI owns CLI assertions; ERR-HTTP-API-A owns 512,000-character boundary assertions. HEALTH-REGISTRY adds `HEALTH-REGISTRY-STUB-01` (test stubs excluded from production-ID validation), DIST-CLI adds `DIST-CLI-TIMEOUT-11..14` and `DIST-CLI-FABLE-11`, EVID-MODEL-CORE adds `EVID-MODEL-DECLARED-13`, ERR-HTTP-API-A adds `HTTP-PROMPT-512K-01..03`, HERM-FS-T3 adds `HERM-FS-T3-STUB-09..12`, and CI-ROOT adds `HERM-CI-TIMEOUT-11`. These are source-refresh scenarios; sdd-tasks must reissue their task bindings next.

## Non-Normative Provenance and Delivery Update

Historical Engram observation #20206 captured the pre-decision state: delivery strategy `ask-on-risk`, with no chain strategy or size exception selected. The later explicit maintainer decision in Engram observation #20343 resolved current planning to an unchained `size:exception`, with no chain strategy. These identifiers and the transition history are provenance only; the normative current state is defined above. The exception is planning context only: it grants no commit, push, PR, release, or other delivery authority and bypasses no task ordering, testing, verification, or RDD requirement.

## Approved 2026-09-04 ownership and gate reconciliation

The earlier developer-container amendment refined owners without changing its then-current 61-unit/127-edge graph. The approved SCAN-ROOT reconciliation now adds seven prerequisite units and twelve net edges, yielding 68 work units, 139 edges, and the same 16-wave cardinality; existing row identifiers and all scenario IDs remain stable. AUTH-RUNTIME's focused behavior scenario remains the normative proof for its four owned implementation paths, supplemented by applicable scanner/hygiene evidence and proportional root typecheck; it is one of the eight admitted completed units and does not own CI-ROOT whole-root proof.

Existing scenario IDs remain unchanged while ownership is split as listed above: SCAN-ROOT-01..16 still include parsing/inventory of planned .devcontainer/devcontainer.json execution-bearing fields and planned .devcontainer/Dockerfile; HERM-ROOT-01..12 cover runner liveness, bounded concurrency, process teardown/signals, and diagnostic timeouts; HERM-IMG-01..12 cover the planned credential-free, non-root Node 22.23.2 / pnpm 9.15.9 developer container, ABI-isolated dependency volumes, and its separation from Dockerfile.test; HERM-CI-01..10 retain the exact root suite plus matching root runtime pins; DASH-CI-01..10 cover matching dashboard manifest declarations while retaining its independent lockfile/project; and CLAIM-01..10 cover README setup, frozen installs, ABI-volume reset guidance, and no-default-credentials guidance. These .devcontainer/** paths are planned, not existing.

The relevant ledger descriptions are consequently read as: HERM-IMAGE owns .devcontainer/** in addition to its existing test-image work (its 280-line ceiling is raised to 340 to contain this coherent image/configuration scope); CI-ROOT solely owns .node-version, root package.json runtime declarations, and CI pins; CI-DASH solely owns dashboard manifest declarations; CLAIMS-FINAL solely owns documentation; and DIST-CLI solely retains production Docker/Compose remediation. No planned path collides with AUTH-RUNTIME's four owned paths.
