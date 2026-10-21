# Architecture migration plan

This plan lists the places that move to the rules in [the prospectus](README.md), in the order we
take them. Tick an item in the same change that lands it, and shrink the matching check baseline.

The findings behind each item, with counts and paths, are in [the audit](audit.md).

## Stage 0: the route gate

- [x] The composer decides whether a chat can send with `routeReadiness` (C7).
- [x] The setup model pick applies to the untouched chat under the setup dialog (C6).

## Stage 2: owners announce

| Item                    | Notice kind            | Consumer                                                       | Owner                                                          |
| ----------------------- | ---------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| [x] Provider connection | `provider.connection`  | Route repair; provider condition cleanup                       | `apps/api/src/features/provider-connections/`                  |
| [x] Project             | `project`              | Plugin backend host refresh                                    | `apps/api/src/features/projects/`                              |
| [x] Agent               | `agent` by key         | Seat and handle repair                                         | `apps/api/src/features/agents/`                                |
| [x] MCP server, plugin  | `mcp`, `plugin` by key | Capability cleanup: rules, OAuth tokens, vault bindings        | `apps/api/src/features/mcp/`, `apps/api/src/features/plugins/` |
| [x] Capability rule     | `capability.rule`      | Relay; semantic index                                          | `apps/api/src/features/capabilities/`                          |
| [x] Message edit        | `chat.message`         | Semantic index                                                 | `apps/api/src/features/chat/`                                  |
| [x] Chat deletion       | `chat.session` cascade | Session residue: sandbox, child loops and monitors, inbox rows | `apps/api/src/features/chat/`                                  |
| [x] Local model         | `local.model`          | Route repair                                                   | `apps/api/src/features/local-models/`                          |

## Stage 3: consumers replace writer-driven follow-ups

- [x] Relay from notices to client topics replaces the mutation wrappers in
      `apps/api/src/bootstrap/resource-sync.ts`: provider connections and capability rules. The
      wrappers for projects (settings), profile, view state, agents, skills, the vault and system
      toggles stay until those owners announce every change.
- [x] Usage ledger projector replaces the fire-and-forget usage write and the boot repair.
- [x] `resolveLanguageModel` picks its connection with `routeReadiness`; the server copy of the rule
      is removed.
- [ ] `resolveLiveCatalogModel` (UI and `@localixai/agent/catalog`) is replaced by `routeReadiness`.

Stays a command: plan approval, capability apply, stopping runs before a chat is deleted, trigger
scheduling, terminal lifecycle and the session event stream.

## Stage 4: layers

- [ ] Only `apps/api/src/bootstrap/` builds another feature's repository or service (A4).
- [ ] Kysely only in repositories (A5); HTTP errors only in routes (A7).
- [ ] Agent tools reach memory and context search through ports.
- [ ] `apps/api/src/db/payload.ts` imports no feature module.
- [ ] Cross-feature cycles in the API shrink to zero (A6).
- [ ] UI slices stop importing each other and gain public entries (A8).
- [x] Desktop calls go through `platformCapabilities` (the inspector and companion are guarded).

## Client synchronization

- [x] One writer for connections; the duplicate SWR keys and manual refreshes go.
- [x] Session writes land through the chat sync layer (`applyServerSession`) instead of
      `_replaceSession` patches from each surface (C6).
- [x] Caches with no topic subscribe to one: the settings model field, settings project lists, the
      model catalog, join routes and linked session previews.
- [x] The transport tells the scheduler when a reconnect replayed every missed frame.

## Plugins

- [x] Plugins can follow core deletions through a read-only subscription.
- [x] One plugin change mechanism instead of `host.changes` beside the store change feed: kept as
      two with distinct jobs (durable backend feed, ephemeral view invalidation), documented in
      `docs/extending/plugin-sync.md`.

## Dead code and legacy

- [x] Enabling an agent bumps the capability revision once.
- [x] Remove the `localStorage` exemption for a file that does not exist.
- [x] Drop the unread `agent_sessions.worktree_session_id` column with a new migration.
- [x] Rename one of the two `recordSessionChanges` functions.

## Checks

- [x] A deterministic check, with a shrinking baseline, for each rule A1–A8 and C1–C7 (C2 and C3 are
      held by the registry types; C5 stays with review).
