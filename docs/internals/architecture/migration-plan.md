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
| [ ] Provider connection | `provider.connection`  | Route repair; provider condition cleanup                       | `apps/api/src/features/provider-connections/`                  |
| [ ] Project             | `project`              | Plugin backend host refresh                                    | `apps/api/src/features/projects/`                              |
| [ ] Agent               | `agent` by key         | Seat and handle repair                                         | `apps/api/src/features/agents/`                                |
| [ ] MCP server, plugin  | `mcp`, `plugin` by key | Capability cleanup: rules, OAuth tokens, vault bindings        | `apps/api/src/features/mcp/`, `apps/api/src/features/plugins/` |
| [ ] Capability rule     | `capability.rule`      | Relay; semantic index                                          | `apps/api/src/features/capabilities/`                          |
| [ ] Message edit        | `chat.message`         | Semantic index                                                 | `apps/api/src/features/chat/`                                  |
| [ ] Chat deletion       | `chat.session` cascade | Session residue: sandbox, child loops and monitors, inbox rows | `apps/api/src/features/chat/`                                  |
| [ ] Local model         | `local.model`          | Route repair                                                   | `apps/api/src/features/local-models/`                          |

## Stage 3: consumers replace writer-driven follow-ups

- [ ] Relay from notices to client topics replaces the mutation wrappers in
      `apps/api/src/bootstrap/resource-sync.ts`.
- [ ] Usage ledger projector replaces the fire-and-forget usage write and the boot repair.
- [ ] `resolveLanguageModel` picks its connection with `routeReadiness`; the server copy of the rule
      and `resolveLiveCatalogModel` are removed.

Stays a command: plan approval, capability apply, stopping runs before a chat is deleted, trigger
scheduling, terminal lifecycle and the session event stream.

## Stage 4: layers

- [ ] Only `apps/api/src/bootstrap/` builds another feature's repository or service (A4).
- [ ] Kysely only in repositories (A5); HTTP errors only in routes (A7).
- [ ] Agent tools reach memory and context search through ports.
- [ ] `apps/api/src/db/payload.ts` imports no feature module.
- [ ] Cross-feature cycles in the API shrink to zero (A6).
- [ ] UI slices stop importing each other and gain public entries (A8).
- [ ] Desktop calls go through `platformCapabilities`.

## Client synchronization

- [x] One writer for connections; the duplicate SWR keys and manual refreshes go.
- [ ] Session writes reach other surfaces through topics instead of `_replaceSession` patches.
- [x] Caches with no topic subscribe to one: the settings model field, settings project lists, the
      model catalog, join routes and linked session previews.
- [x] The transport tells the scheduler when a reconnect replayed every missed frame.

## Plugins

- [ ] Plugins can follow core deletions through a read-only subscription.
- [ ] One plugin change mechanism instead of `host.changes` beside the store change feed.

## Dead code and legacy

- [ ] Enabling an agent bumps the capability revision once.
- [ ] Remove the `localStorage` exemption for a file that does not exist.
- [ ] Drop the unread `agent_sessions.worktree_session_id` column with a new migration.
- [ ] Rename one of the two `recordSessionChanges` functions.

## Checks

- [ ] A deterministic check, with a shrinking baseline, for each rule A1–A8 and C1–C7.
