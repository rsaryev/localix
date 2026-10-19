# Global search internals

Global search merges ranked hits from core services, enabled plugins, and client-only navigation
indexes. Use this reference when adding a search domain, changing result activation, or tuning
grouping and pagination.

## Terminology

| Term           | Meaning                                                     | Boundary                                                           |
| -------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| Domain         | A stable provider id used for filtering and result grouping | One provider owns each registered id                               |
| Eager provider | Runs when a query has no explicit domain filter             | Registry waits at most 2.5 seconds; provider work is not cancelled |
| Lazy provider  | Runs only when its domain is selected                       | Default “All” search does not contact it                           |
| Aggregate view | Several domains grouped in registry order                   | Shows a capped preview per group                                   |
| Scoped view    | Exactly one backend domain with offset-cursor pagination    | Client-only scopes never call the backend                          |
| Activation URI | A result's `uri`, or its `id` when `uri` is absent          | Resolution belongs to the shared UI navigation registry            |

## What you can do

| Operation                  | Mechanism                                                                              | Boundary                                                           |
| -------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Open quick search          | Run `mod+shift+f` to open the grouped command-dialog surface                           | The chord is user-remappable through the shared keybinding catalog |
| Keep a search tab open     | Open the global-search work item from the rail or **Open in Search**                   | One tab per chat; it searches that chat's workspace                |
| Narrow a query             | Choose a scope or type a recognized prefix such as `f:` or `msg:`                      | Unknown prefixes remain literal query text                         |
| Page one domain            | Select **Show all** and request 30-hit pages with an opaque offset cursor              | Pagination applies only to one backend domain                      |
| Open a result              | Resolve its canonical resource or UI URI through `invokeUi`                            | Write commands require a user-selected `commands` hit              |
| Contribute a plugin domain | Register a backend provider plus matching UI scope, icon, and activation anchor        | The enabled plugin owns its lifecycle and must namespace its id    |
| Search by meaning          | Always on once its model is here; providers with a collection receive `query.semantic` | Chats and messages today; see [semantic index](semantic-index.md)  |
| Search from the agent      | `global_search` calls the same service with the run's session and project              | Hits inside the agent's own conversation are left out              |

The [UI anchors](ui-anchors.md) page owns activation grammar. The
[workbench contribution](workbench-contributions.md) page owns plugin registration rules.

## How it works

```text
GlobalSearchPalette or GlobalSearchTab
  -> useGlobalSearch and SearchRequestCoordinator
  -> POST /rpc/search
  -> SearchService (picks the strategy: lexical, or hybrid with query.semantic)
  -> SearchProviderRegistry parallel fan-out
  -> provider-local matches
  -> service grouping, sorting, and pagination
  -> browser merge with Settings, UI locations, and Commands
  -> shared URI activation
```

### Module contracts

| Module                                                                                                  | Mechanism and invariant                                                                                                                         | Failure when violated                                                            |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`search-provider.ts`](../../../packages/plugin-sdk/src/backend/search-provider.ts)                     | Rejects duplicate ids, selects eager or named providers, stamps domains, caps hits, and reports provider failure or timeout as a domain problem | One provider can stall or mislabel the complete result set                       |
| [`boot/search.ts`](../../../apps/api/src/boot/search.ts)                                                | Registers core providers in display order and attaches the live plugin backend registry                                                         | Group order changes or plugin enable/disable stops matching availability         |
| [`service.ts`](../../../apps/api/src/features/search/service.ts)                                        | Owns cross-provider sorting, grouped previews, totals, and single-domain pagination                                                             | Endpoint consumers can disagree about result shape or page boundaries            |
| [`contracts.ts`](../../../apps/api/src/features/search/contracts.ts)                                    | Requires non-empty text and caps the requested limit at 100                                                                                     | Unbounded or empty searches reach every selected provider                        |
| [`scopes.ts`](../../../apps/ui/src/features/search/model/scopes.ts)                                     | Maps known prefixes to backend or client-only domains and merges plugin scope atoms                                                             | UI filters can request an unregistered provider or hide a live plugin domain     |
| [`searchClient.ts`](../../../apps/ui/src/features/search/model/searchClient.ts)                         | Searches Settings, registered UI locations, and commands without server state                                                                   | Navigation-only results leak into backend contracts                              |
| [`searchRequestCoordinator.ts`](../../../apps/ui/src/features/search/model/searchRequestCoordinator.ts) | Aborts superseded fetches and allows one load-more request per current sequence                                                                 | Slow results overwrite a newer query or duplicate a page                         |
| [`activateSearch.ts`](../../../apps/ui/src/features/search/model/activateSearch.ts)                     | Uses registry-first URI activation and permits write intent only for selected command hits                                                      | Search becomes a second, inconsistent navigation table or widens write authority |

### Registered core domains

| Domain     | Data source and match fields                                                     | Boundary                                                      |
| ---------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `projects` | Project name and working directory                                               | Eager; user-scoped project list                               |
| `sessions` | Chat and subsession titles                                                       | Eager; honors the supplied project scope                      |
| `messages` | FTS5 message history with a best-effort session title                            | Eager; capped to 60 provider results                          |
| `files`    | File names and ripgrep content lines under the query session's working directory | Eager but returns no hits without `sessionId`                 |
| `secrets`  | Vault key, label, and type metadata                                              | Eager; secret values are not read                             |
| `skills`   | Skill name and description                                                       | Eager; uses the supplied project scope                        |
| `plugins`  | Plugin name, display name, and description                                       | Eager; uses the supplied project scope                        |
| `mcp`      | Saved server name and description                                                | Eager; does not connect to or probe the server                |
| `agents`   | Reusable-agent name, label, and description                                      | Eager; uses the supplied project scope                        |
| `models`   | Runtime catalog model id and name                                                | Eager; the composition root caches the catalog for 30 seconds |

Enabled backend plugins register at runtime through `PluginBackendHost.setSearchRegistry`. Current
plugin domains include database connections, saved API requests, Docker resources, Kubernetes pods,
trading markets, and Kanban cards. Their owning plugins define tier, matching, resource URI, and
shutdown behavior; global search only enforces the registry contract.

The Kanban plugin's `kanban:tasks` domain
([`references.ts`](../../../plugins/kanban/backend/references.ts)) is eager and matches a card's
title, description and id. It reads only the board of the query's `sessionId` — the chat the search
tab or palette belongs to — and returns no hits without one, because a board belongs to its chat.

### Client-only domains

| Domain     | Index                                     | Activation boundary                                                    |
| ---------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| `settings` | Static settings index                     | Opens the exact settings tab and anchor                                |
| `ui`       | Registered UI locations exposed to search | Opens only addressable descriptors                                     |
| `commands` | Live UI command registry                  | A selected action command may pass `allowWrite`; other domains may not |

The tab merges all three client domains. The palette also receives the live command registry. Both
surfaces use the same client-group builder and server hook.

### Partial results and request lifetime

Providers can return a plain hit array or `{ hits, problem }`. The registry preserves reported
problems, stamps their domain, and turns an exception or timeout into a problem with no hits from
that provider. The service includes `problems` only when that list is non-empty; other domains can
still return results.

The search tab renders one report for request and domain failures and owns its Event Center entry.
The transient palette renders the same findings without owning that entry. A failed HTTP request
blocks the results surface; a domain problem appears beside available results. Some providers still
catch failures internally and return an empty array, so absence of `problems` is not proof that
every underlying source was successfully searched.

The UI aborts obsolete requests and ignores late responses when a query or scope changes. The
provider port has no abort signal: the registry timeout bounds waiting, not the provider’s lifetime.
Load-more requests re-run the provider and append the returned slice. A failed page shows a toast
and keeps the earlier hits; domain problems from a later page are not merged into the primary
response’s findings.

## Configuration

| Control                | Current value      | Effect                                                  |
| ---------------------- | ------------------ | ------------------------------------------------------- |
| Endpoint               | `POST /rpc/search` | Accepts the shared `SearchRequest` contract             |
| Default group limit    | `6`                | Aggregate tab hits per backend group                    |
| Palette group limit    | `5`                | Aggregate palette hits per group                        |
| Scoped page size       | `30`               | Hits requested for each single-domain page              |
| Aggregate provider cap | `24`               | Maximum hits accepted from one provider before grouping |
| Scoped provider cap    | `200`              | Maximum searchable depth for one backend domain         |
| Provider timeout       | `2500` ms          | Returns no hits and a problem for a slow provider       |
| UI debounce            | `90` ms            | Delays the server fetch after query changes             |
| Default keybinding     | `mod+shift+f`      | Opens or closes the quick-search palette                |

Provider registration order is user-visible group order. Treat changes to
[`boot/search.ts`](../../../apps/api/src/boot/search.ts) as presentation changes as well as
composition changes.

## Limits

- The endpoint rejects a zero-length query, but does not trim whitespace. The UI trims queries and
  clears server results for a blank query instead of sending it.
- “All” selects eager providers only. Docker, Kubernetes, trading, and other live or expensive
  domains require their explicit scopes.
- Timeouts and uncaught provider errors are reported as domain problems. A disabled plugin is absent
  from the registry. An internally swallowed provider error can still look like no matches.
- Project and session ids are interpreted by each provider. The service turns omitted ids into
  `null`; Chats and Messages filter by that project value, so omission is not an unfiltered history
  query. Message matching fetches at most 60 history hits before the project filter; matches beyond
  that window may not appear even in a scoped search.
- File search requires the search's own session and uses that session's effective working directory.
- Aggregate totals are totals after provider caps, not counts of every possible source record.
- The offset cursor is opaque at the API boundary but currently encodes a numeric offset. Changing
  sort order between pages can move or repeat results.
- The agent's `global_search` tool and the UI share this service and its ranking; the tool adds only
  its own-conversation filter, the history reads (`around_message_id`, `session_id`, browse) and a
  model-sized output budget.
- `strategy: 'lexical'` on a request forces words-only matching; `allProjects` lifts the project
  filter. Every response names its strategy, and the UI shows it only while semantic search is on.

## Related guides

- [UI anchors](ui-anchors.md)
- [Workbench contributions](workbench-contributions.md)
- [Workspace](../../features/workspace.md)
- [DevOps Workspace](../../features/devops.md)

## Source of truth

- [Registry and timeout](../../../packages/plugin-sdk/src/backend/search-provider.ts) ·
  [search-provider.test.ts](../../../packages/plugin-sdk/src/backend/search-provider.test.ts)
- [Service grouping and paging](../../../apps/api/src/features/search/service.ts) ·
  [service.test.ts](../../../apps/api/src/features/search/service.test.ts)
- [Core composition](../../../apps/api/src/boot/search.ts)
- [HTTP route](../../../apps/api/src/features/search/routes.ts)
- [Shared UI state](../../../apps/ui/src/features/search/model/useGlobalSearch.ts) ·
  [searchRequestCoordinator.test.ts](../../../apps/ui/src/features/search/model/searchRequestCoordinator.test.ts)
- [Request sequencing and aborts](../../../apps/ui/src/features/search/model/searchRequestCoordinator.ts)
- [Core file and history providers](../../../apps/api/src/features/chat/search-provider.ts)
- [Search tab and palette](../../../apps/ui/src/features/search/ui/GlobalSearchTab.tsx) ·
  [GlobalSearchPalette.tsx](../../../apps/ui/src/features/search/ui/GlobalSearchPalette.tsx)
- [Client navigation indexes](../../../apps/ui/src/features/search/model/searchClient.ts) ·
  [searchClient.test.ts](../../../apps/ui/src/features/search/model/searchClient.test.ts)
