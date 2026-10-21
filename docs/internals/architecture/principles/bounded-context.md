# Bounded context

A large domain is split into contexts, each with its own consistent model and one owner, and the
relationships between contexts are made explicit. Localix uses it to decide which feature owns a
concept and where a shape must be translated rather than shared.

## Source

Martin Fowler, "BoundedContext", bliki, 15 January 2014.
<https://martinfowler.com/bliki/BoundedContext.html>

## What the source says

Bounded context is the central pattern of Domain-Driven Design's strategic design. A model is useful
as a shared language only while it stays internally consistent, and that becomes harder as an
organisation grows. Fowler quotes Eric Evans: "total unification of the domain model for a large
system will not be feasible or cost-effective".

The same word often means different things in different parts of an organisation; Fowler's example
is "meter" at a utility. Software needs precision, so each meaning belongs to its own context.
Boundaries usually follow human language and teams, but can also appear inside one application.

Contexts can share concepts such as customer or product while modelling them differently. DDD
describes several kinds of relationship between contexts and records them in a context map. Where a
concept crosses a boundary, a mapping translates it. The article names these ideas without detailing
the techniques.

## Rules we take

- Give each concept one owning feature; other features read it through that owner's contract, not
  its tables.
- Declare the structural subset a feature needs locally instead of importing a richer type from the
  feature that calls it.
- Translate at the edge: a feature's exported contract file (for example `contracts/`) is the only
  shape other contexts may depend on.
- Keep features that a host asks (`agents`, `triggers`, `work`) free of any import from that host.
- Record cross-context edges that are intentional; treat unrecorded mutual imports as defects.

## How Localix applies it today

Ownership is written down in the ownership table of
[the architecture overview](../../architecture.md) and in [the code map](../../code-map.md). For
example, wakes enter only through `chatService.wakeSession` with the `WakeRequest` contract in
`apps/api/src/features/chat/contracts/queue.ts`.

`apps/api/src/features/host-boundaries.test.ts` forbids `agents`, `triggers` and `work` from
importing `features/chat`, even as a type; each declares the structural subset it needs. The same
test records why the earlier mutual imports went stale.

Plugins are separate contexts. `scripts/check-architecture.mjs` reports "plugin ... imports sibling
plugin", "host imports concrete plugin source" and "plugin imports workspace internals", so a plugin
and the host meet only through `packages/plugin-sdk`. Browser and server share a rule through narrow
export-map leaves in `apps/api/package.json`, enforced by `scripts/browser-graph-guard.test.ts`.

## Known gaps

- No context map exists as a single artifact; ownership is spread across the overview, the code map
  and test headers.
- Features still import each other's types, and some call each other through ports that only the
  composition root (`apps/api/src/bootstrap/`, A4) may construct; value-import cycles between
  features are at zero (A6).
- Only three features are covered by `host-boundaries.test.ts`.
