# Architecture audit, 2026-10-21

This audit measures the code on `main` against the rules in
[the architecture prospectus](README.md). Use it to seed the check baselines and to pick the next
refactoring; re-run it after a stage lands.

Counts are from import scans of non-test files on 2026-10-21. A finding names the rule it breaks.

## Status after the stages landed

The stages in [the migration plan](migration-plan.md) have since landed. The baselines in
`scripts/architecture-baselines/` now read A1–A8: 0, C1: 3, C4: 1, C6: 0, C7: 1, checked on every
`bun run test`. The change feed is no longer read by the semantic index alone: the relay to client
topics, the usage ledger projector, route repair, agent seats, capability cleanup, session residue
and the plugin backends consume it (`apps/api/src/bootstrap/core-reactors.ts`). The findings below
record the code as it was on 2026-10-21, as the starting point those stages fixed; they are not the
current state.

## Scorecard

| Claim       | Verdict                                              | Main evidence                                                                                                                    |
| ----------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Agnostic    | Mostly holds                                         | `packages/agent` and `packages/engine-loop` import no provider, framework or IO; provider SDKs live in `packages/engine-models`. |
| Layered     | Holds between packages and UI layers; not in the API | No package imports an app; no package cycle; 36 two-way import cycles between API features.                                      |
| Clean       | Does not hold inside `apps/api`                      | Services and policies use Kysely and build other features' repositories; HTTP errors in domain code.                             |
| Change feed | One consumer, many silent writes                     | Only the semantic index subscribes; connections, projects and agents record no notices.                                          |

## Agnostic core (A2, A3, C7)

| Finding                                                                                      | Where                                                                                                                    |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Holds: the agent contracts import only zod and two small utilities.                          | `packages/agent/src`                                                                                                     |
| Holds: the loop imports only `@localixai/agent` and zod; its provider ban is checked.        | `ENGINE_LAYERS` in `scripts/check-architecture.mjs`                                                                      |
| The provider-SDK ban covers only `engine-loop`, not every core package.                      | `scripts/check-architecture.mjs`                                                                                         |
| `plugin-sdk` binds React, zustand, Hono and `node:*`; only its subpaths keep them apart.     | `packages/plugin-sdk/src/backend/http.ts`, `packages/plugin-sdk/src/ui/resource-sync.ts`                                 |
| The UI client is typed through the API's Hono app rather than a contracts package.           | `apps/ui/src/shared/api/internal.ts`                                                                                     |
| The server treats a connection id as a hint; the composer treats it as required (two rules). | `apps/api/src/features/chat/runtime/model-resolution.ts`, `apps/ui/src/entities/chat/ui/prompt-input/connectionScope.ts` |
| Provider names appear as data in setup scenes and the model order list.                      | `apps/ui/src/widgets/workspace-tips/ui/scenes/ModelScene.tsx`, `packages/agent/src/catalog/model-order.ts`               |

## Layers and ownership (A4–A8)

| Finding                                                                                                                     | Where                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1,064 cross-feature imports over 204 edges in API features; 36 two-way cycles, 20 with values.                              | `apps/api/src/features/*`                                                                                                            |
| The chat runner builds capabilities, usage, memory, user, projects and MCP repositories itself.                             | `apps/api/src/features/chat/runtime/agent-runner.ts`                                                                                 |
| The chat service graph builds foreign repositories and the plugin service.                                                  | `apps/api/src/features/chat/service/service-graph.ts`                                                                                |
| A registration policy queries and inserts with Kysely and throws HTTP errors.                                               | `apps/api/src/features/agents/registration-policy.ts`                                                                                |
| Raw SQL in chat service code outside repository modules.                                                                    | `apps/api/src/features/chat/service/delegated-runs.ts`, `apps/api/src/features/chat/service/command-handlers-agents.ts`              |
| Availability and plugin dependency rules take Kysely directly.                                                              | `apps/api/src/features/capabilities/availability.ts`, `apps/api/src/features/plugins/dependencies-policy.ts`                         |
| Agent tools import concrete repositories instead of ports (79 repository imports across features).                          | `apps/api/src/features/agent-core/tools/memory/memory.ts`, `apps/api/src/features/agent-core/tools/context-search/context-search.ts` |
| The storage layer type-imports feature modules.                                                                             | `apps/api/src/db/payload.ts`                                                                                                         |
| `ApiError`, an HTTP-shaped error, is thrown from 69 non-route feature files.                                                | `apps/api/src/lib/errors.ts`                                                                                                         |
| UI feature slices import each other: 129 imports over 23 edges, cycles chat↔settings, chat↔inspector, chat↔external-agents. | `apps/ui/src/features/inspector/model/revealPreview.ts`, `apps/ui/src/entities/chat/model/seatEffortMemory.ts`                       |
| UI slices have no public entry; outsiders import `model/store` and other internals.                                         | `apps/ui/src/features/companion/model/roster.ts`                                                                                     |
| Desktop calls bypass the platform layer in inspector and companion features.                                                | `apps/ui/src/features/inspector/ui/useNativeBrowserPage.ts`                                                                          |

Good examples to copy: the directory port in `apps/api/src/bootstrap/agent-directory-ports.ts`, the
pure policy in `apps/api/src/features/agents/policy.ts`, and the runtime ports in
`apps/api/src/features/chat/runtime/run/runtime-tool-ports.ts`.

## Change feed coverage (C1, C5)

| Fact                                         | Today                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Chat session and message insert or delete    | Recorded in the owner's transaction.                                                                         |
| Message edit                                 | Not recorded; only the session upsert at run end catches it.                                                 |
| Skill, plugin, MCP, agent                    | One debounced `resync` of all four, outside a transaction (`apps/api/src/features/capabilities/changes.ts`). |
| Capability rule switch                       | Bumps the revision but reaches no other open window.                                                         |
| Provider connection, project, profile, vault | Client topics only, which are lost on restart; no notice.                                                    |
| Consumers                                    | One: the semantic index (`apps/api/src/bootstrap/semantic-changes.ts`).                                      |
| Plugin streams                               | Available through `host.changes`; no plugin uses them.                                                       |

Follow-ups driven by the writer instead of a consumer, most valuable first:

1. Provider connection delete cleans no route, project default, user routing, loop or condition
   (`apps/api/src/features/provider-connections/service.ts`).
2. MCP server and plugin delete leave name-keyed rules, OAuth tokens and vault bindings
   (`apps/api/src/features/mcp/service.ts`, `apps/api/src/features/plugins/service.ts`).
3. Agent delete runs three non-transactional steps and leaves seats, cards and handles
   (`apps/api/src/features/agents/service.ts`).
4. Project changes never refresh project-scoped plugin backends
   (`apps/api/src/bootstrap/plugin-hosts.ts`).
5. Session delete cleans files after commit; child loops and monitors are reaped only for the root
   (`apps/api/src/features/chat/service/session-deletion.ts`,
   `apps/api/src/features/chat/service/session-facade.ts`).
6. Usage rows are written fire-and-forget and repaired at boot
   (`apps/api/src/features/chat/runtime/usage-normalize.ts`).
7. Client topics are added by wrapping service methods, with no test of the mapping
   (`apps/api/src/bootstrap/resource-sync.ts`).

## References that outlive their target (P10, C1)

| Holder                                             | Target              | After the target is deleted                                      |
| -------------------------------------------------- | ------------------- | ---------------------------------------------------------------- |
| `conversation_participants.provider_connection_id` | Provider connection | Set to null; the model stays, so new chats inherit a dead route. |
| `agent_sessions.model_choices`                     | Provider connection | The dead id stays and is offered as the newest pick.             |
| Project settings and user model routing            | Provider connection | The dead id stays; runs recover, the UI does not.                |
| `conversation_participants.agent_id` and `handle`  | Agent               | Turns fail as unavailable; a renamed handle no longer routes.    |
| Capability rules keyed by name                     | Skill, plugin, MCP  | A new item with the same name inherits the old allow or deny.    |
| `agent_sessions.pinned_skills`, skill usage rows   | Skill               | Silently skipped, or inherited by a new skill with the name.     |
| Provider condition rows in the notification inbox  | Provider connection | Stay open with a sign-in action for a connection that is gone.   |
| Notification inbox rows for a deleted chat         | Chat                | Stay until a restart sweep, linking to nothing.                  |
| Vault bindings of a removed plugin                 | Plugin              | Keep the secret marked in use.                                   |

## Client synchronization (C6, P11, P12)

| Finding                                                                                    | Where                                                                                                                        |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Connections have five writers; only the realtime adapter discards a stale answer.          | `apps/ui/src/entities/chat/model/store.ts`, `apps/ui/src/entities/chat/model/useWorkspace.ts`                                |
| Writers patch readers directly: the setup model step and the connections hook.             | `apps/ui/src/widgets/workspace-tips/ui/scenes/ModelScene.tsx`, `apps/ui/src/entities/chat/ui/prompt-input/useConnections.ts` |
| About 25 sites replace a session in the store with their own response.                     | `apps/ui/src/entities/chat/model/sessionModelSelectionActions.ts`                                                            |
| Caches with no topic: the settings model field, settings project lists, the model catalog. | `apps/ui/src/shared/ui/ModelFieldSelect.tsx`, `apps/ui/src/shared/hooks/useModelsCatalog.ts`                                 |
| A reconnect invalidates every resource instead of catching up after a position.            | `packages/plugin-sdk/src/ui/resource-sync.ts`                                                                                |
| Topic names are repeated in the API and the UI.                                            | `apps/api/src/features/realtime/resources.ts`, `apps/ui/src/shared/api/resourceSyncTransport.ts`                             |

## Recorded exceptions

| Exception                                                                                                                                                                                                                                         | Where                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Claude Code agent isolation: core creates git worktrees for a subagent's or workflow agent's `isolation: 'worktree'` and runs `WorktreeCreate` hooks, as part of the Claude Code format; the git-workspace plugin keeps its own worktree feature. | `scripts/git-workspace-ownership.test.ts` (`CLAUDE_CODE_ISOLATION`) |

## Next audit

Re-run the import scans and the reference inventory after each roadmap stage, update the counts
here, and shrink the baselines by the same amount.
