# Code Graph

A map of a chat's project in the workbench — directories, files and symbols joined by imports, calls
and inheritance — and seven agent tools that query the graph and control its view. User
documentation is [docs/features/code-graph.md](../../docs/features/code-graph.md); this file is for
working on the mini app.

## Layout

| Path                   | Answers                                                                         |
| ---------------------- | ------------------------------------------------------------------------------- |
| `shared/model.ts`      | The closed node and edge vocabulary both sides use.                             |
| `shared/ids.ts`        | The one place a node id is spelled.                                             |
| `shared/view.ts`       | The snapshot the view polls, as zod schemas.                                    |
| `shared/stream.ts`     | The frames pushed to an open tab: agent requests, report asks, revisions.       |
| `shared/changes.ts`    | Which directories are never walked, and which file changes can move the map.    |
| `backend/extract/`     | One file's facts, from tree-sitter (WASM), per language.                        |
| `backend/indexing/`    | Which files exist, which changed, the SQLite extraction cache, the refresh job. |
| `backend/graph/`       | Resolution (modules, names, members, field types) and queries over the graph.   |
| `backend/tools.ts`     | The agent tools; `describe.ts` renders their budgeted text.                     |
| `backend/view-tool.ts` | The visible graph report and camera-control tool.                               |
| `ui/`                  | The workbench: one level laid out with dagre, drawn on `@localixai/kit/canvas`. |

## Rules this mini app keeps

- **Extraction never looks at another file.** A file's extraction depends only on its bytes, so it
  is cached by content hash; every cross-file edge is rebuilt from the cache on each build. A change
  to what an extractor emits bumps `EXTRACTOR_VERSION`, which drops stale cache rows.
- **A miss stays a miss.** A name with two candidate declarations, or a call on a value of unstated
  type, produces no edge. Resolution statistics report it instead.
- **The view receives one level.** Edges are lifted to the level on the server (`graph/view.ts`);
  the browser never downloads the whole graph. Layout is keyed on the level's content, so polling
  and selection never move a box. The drawing plan bounds overview edges, while focus shows the
  exact relations of the chosen node. The inspector still reads the full graph.
- **Ids come from `shared/ids.ts` only**, and are project-relative.
- **The tab is told, not polling.** File changes reach the index through `POST /changed`; a new
  revision, an agent request and a tool's camera question reach the tab as frames
  (`backend/ws-frames.ts`). While both change and realtime signals are live, an idle graph has no
  snapshot poll. Indexing refreshes every 1.5 seconds; a disconnected idle graph falls back to 8
  seconds. Camera reports retain an 8-second backstop.

## Checks

```bash
bun test mini-apps/code-graph            # from the repository root
bun run --cwd mini-apps/code-graph type-check
```

A language is added with a walker in `backend/extract/lang/`, its grammar in
`backend/extract/parser.ts`, its extensions in `backend/extract/index.ts`, a module resolver in
`backend/graph/modules/` and cases in the extraction and build tests.

## Source of truth

- [Mini app manifest](mini-app.json) and [agent guide](guide.md)
- [Query tool registration](backend/tools.ts)
- [Camera tool](backend/view-tool.ts)
- [Graph reads and signal health](ui/useGraph.ts)
- [Camera reports](ui/useAgentCamera.ts)
