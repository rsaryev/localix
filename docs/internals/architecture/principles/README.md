# Architecture principles

These notes record the external principles behind Localix's claim to be agnostic, layered and clean.
Each note paraphrases its source, states checkable rules for this repository, and lists what is
enforced today and what is not.

Read [the architecture overview](../../architecture.md) for the system and
[the code map](../../code-map.md) for where a change goes.

## Index

| Principle                                                       | Rule                                                                  | Source                                                                                                           | Enforced today                                                                                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Clean Architecture](clean-architecture.md)                     | Source dependencies point inward; inner code declares ports.          | [Martin, 2012](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)                     | `scripts/check-architecture.mjs`: agent-package boundary, `ENGINE_LAYERS`, composition-root rule; `agnostic-boundary.test.ts`                                                       |
| [Hexagonal ports and adapters](hexagonal-ports-and-adapters.md) | The core reaches every technology through a port; adapters translate. | [Cockburn, 2005](https://alistair.cockburn.us/hexagonal-architecture/)                                           | Partly: `ENGINE_LAYERS` provider ban, `platformCapabilities` checks, `scripts/api-contract-guard.test.ts`                                                                           |
| [Layering](layering.md)                                         | Domain modules first; presentation, domain, data inside each.         | [Fowler, 2015](https://martinfowler.com/bliki/PresentationDomainDataLayering.html)                               | Not enforced inside API features; UI `apiFetch` rule in `scripts/check-architecture.mjs`                                                                                            |
| [Bounded context](bounded-context.md)                           | One owner per model; other contexts use its contract.                 | [Fowler, 2014](https://martinfowler.com/bliki/BoundedContext.html)                                               | Partly: `apps/api/src/features/host-boundaries.test.ts`; plugin rules and `pluginWorkspaceImportProblem` in `scripts/check-architecture.mjs`; `scripts/browser-graph-guard.test.ts` |
| [Feature-Sliced Design](feature-sliced-design.md)               | UI imports only from lower layers; no same-layer slice imports.       | [feature-sliced.design](https://feature-sliced.design/docs/reference/layers)                                     | Layer order: `uiLayer` check in `scripts/check-architecture.mjs`; same-layer slices and public APIs not enforced                                                                    |
| [Package principles](package-principles.md)                     | No dependency cycles; depend toward stable, abstract packages.        | Martin, via [Wikipedia](https://en.wikipedia.org/wiki/Acyclic_dependencies_principle) (primary page unreachable) | Partly: undeclared-import check, `ENGINE_LAYERS`, `kitBoundaryProblem`; cycles not enforced                                                                                         |
| [Agnostic core](agnostic-core.md)                               | The core names no provider, UI framework, transport or storage.       | Synthesis of the notes above                                                                                     | Partly: provider ban on `packages/engine-loop`, composition-root rule; React, Hono, Kysely bans not enforced                                                                        |

## Related checks

- `bun run check:architecture` runs `scripts/check-architecture.mjs`. Its plugin rules are
  `pluginSdkLayerProblem`, `pluginHostBoundaryProblem` and `pluginWorkspaceImportProblem`; its kit
  rule is `kitBoundaryProblem`.
- `packages/oxlint-rules` holds per-node rules for the visual system. None of its rules concerns
  module boundaries today.
- Source-reading boundary tests use `apps/api/src/lib/source-lint.ts`.
