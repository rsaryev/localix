# Architecture principles

These notes record the external principles behind Localix's claim to be agnostic, layered and clean.
Each note paraphrases its source, states checkable rules for this repository, and lists what is
enforced today and what is not. The rule ids (A1–A8, C1–C7) and their current baselines are in
[the architecture rules](../README.md#rules); the baselines live in
`scripts/architecture-baselines/`.

Read [the architecture overview](../../architecture.md) for the system and
[the code map](../../code-map.md) for where a change goes.

## Index

| Principle                                                       | Rule                                                                  | Source                                                                                                           | Enforced today                                                                                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Clean Architecture](clean-architecture.md)                     | Source dependencies point inward; inner code declares ports.          | [Martin, 2012](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)                     | `scripts/check-architecture.mjs`: agent-package boundary, `ENGINE_LAYERS`, composition-root rule; `agnostic-boundary.test.ts`                                                          |
| [Hexagonal ports and adapters](hexagonal-ports-and-adapters.md) | The core reaches every technology through a port; adapters translate. | [Cockburn, 2005](https://alistair.cockburn.us/hexagonal-architecture/)                                           | Partly: `ENGINE_LAYERS` provider ban, `platformCapabilities` checks, `scripts/api-contract-guard.test.ts`                                                                              |
| [Layering](layering.md)                                         | Domain modules first; presentation, domain, data inside each.         | [Fowler, 2015](https://martinfowler.com/bliki/PresentationDomainDataLayering.html)                               | A5 (Kysely only in repositories) and A7 (HTTP errors only in routes), baselines 0; UI `apiFetch` rule in `scripts/check-architecture.mjs`                                              |
| [Bounded context](bounded-context.md)                           | One owner per model; other contexts use its contract.                 | [Fowler, 2014](https://martinfowler.com/bliki/BoundedContext.html)                                               | Partly: `apps/api/src/features/host-boundaries.test.ts`; mini app rules and `miniAppWorkspaceImportProblem` in `scripts/check-architecture.mjs`; `scripts/browser-graph-guard.test.ts` |
| [Feature-Sliced Design](feature-sliced-design.md)               | UI imports only from lower layers; no same-layer slice imports.       | [feature-sliced.design](https://feature-sliced.design/docs/reference/layers)                                     | Layer order: `uiLayer` in `scripts/check-architecture.mjs`; A8 forbids same-layer slice imports (baseline 0); public entries not yet enforced                                          |
| [Package principles](package-principles.md)                     | No dependency cycles; depend toward stable, abstract packages.        | Martin, via [Wikipedia](https://en.wikipedia.org/wiki/Acyclic_dependencies_principle) (primary page unreachable) | A1 (no package imports an app or a mini app; no package cycle) and A6 (no feature cycle), baselines 0; undeclared-import check, `ENGINE_LAYERS`, `kitBoundaryProblem`                  |
| [Agnostic core](agnostic-core.md)                               | The core names no provider, UI framework, transport or storage.       | Synthesis of the notes above                                                                                     | A2 (no React, Hono, Kysely, `bun:sqlite`, `node:*` or provider SDK in the core) and A3 (provider SDKs only in `engine-models`), baselines 0; composition-root rule                     |

## Related checks

- `bun run check:architecture` runs `scripts/check-architecture.mjs`. Its kit rule is
  `kitBoundaryProblem`.
- `packages/oxlint-rules` holds per-node rules for the visual system. None of its rules concerns
  module boundaries today.
- `scripts/architecture-rules.test.ts` (A1–A7) and `scripts/architecture-flow-rules.test.ts` (A8,
  C1, C4, C6, C7) check the rules against their baselines; both run in `bun run test`.
- Source-reading boundary tests use `@localixai/source-lint` (`packages/source-lint`) and
  `apps/api/src/lib/source-lint.ts`.
