# Dynamic plugin diagnostics

`getDynamicPluginDiagnostics()` is an additive, in-process, source-level accessor exported from
`src/server/mcp.ts`. It returns an allowlisted detached snapshot:

```ts
{
  enabled: boolean;
  loaded: number;
  issues: Array<{ code: string; count: number }>;
}
```

The `issues` codes are closed, fixed values. The view does not expose plugin identifiers,
paths, tool names, or error messages. Unknown input codes are represented only as
`unknown`; raw code strings are never forwarded. The snapshot is constructed without
reading issue identity or message fields, and mutating it cannot mutate the runtime
summary.

`getDynamicPluginLoadSummary()` remains unchanged for existing in-process consumers;
it is the legacy detailed view and can contain raw plugin metadata. Actual MCP tool
names are unchanged. The new view does not add an MCP tool, HTTP route, or npm/package
export surface; no such external-surface claim is made.

## Identity and authorization boundary

The runtime registry's filename admission and collision handling are internal routing
and compatibility behavior. They are not scanner-issued diagnostic IDs and they are
not supply-chain authorization. The canonical WP00 contract requires diagnostic IDs
issued by the scanner; this document does not invent a signer, trust root, or signed
authorization system. The archived worker-runtime scope
does not remove those remaining identity requirements.

This aggregation is therefore a privacy projection, not a scanner-issued identity
mapping and not provenance proof. It is also not a universal hostile-proxy safety
guarantee: it relies on the existing trusted runtime summary while intentionally
minimizing which fields are read.

## Bounded evidence

The diagnostics file contributed **6 named cases** to the approved **23/23** disjoint
Node 22.23.2 handoff; the other 17 cases belong to neighboring loader and registry
files. This was direct `node --import tsx` execution in the isolated snapshot, not a
test-runner aggregate and not a build. Snapshot hash: `15805fcc3e8a2d82341dc829dd18a3a0b0296ee91707b439d5baa2335322650b`.
