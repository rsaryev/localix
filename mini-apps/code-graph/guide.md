_Use: Answer questions about how a codebase is structured with the Code Graph: where something is,
who uses it, what it depends on, what breaks if it changes, how two parts connect, and where imports
go in circles. Use before reading many files to orient, and when walking the user through code._

# Explore the code graph

The Code Graph is a map of this chat's project built from its syntax: directories, files and
symbols, joined by `imports`, `calls`, `extends` and `implements`. It answers structural questions
in one call that would otherwise take a dozen file reads. Every result prints node ids
(`sym:src/a.ts#Client.send`, `file:src/a.ts`, `dir:src`); pass them back to any tool.

## Pick the tool by the question

| Question                                      | Tool                  |
| --------------------------------------------- | --------------------- |
| "What is in this project / this directory?"   | `code_graph_overview` |
| "Where is X?"                                 | `code_graph_search`   |
| "Who calls / imports X?" "What does X use?"   | `code_graph_node`     |
| "What breaks if I change X?"                  | `code_graph_impact`   |
| "How does X reach Y?"                         | `code_graph_path`     |
| Showing the user what you are talking about   | `code_graph_show`     |
| What the visible tab shows; moving its camera | `code_graph_view`     |

Start an unfamiliar codebase with `code_graph_overview`, then narrow with `path` to the directory
that matters. Before a refactor, run `code_graph_impact` on what you will change and name the
affected files in your plan.

Impact follows resolved incoming edges for three hops by default; `depth` accepts 1–5. It lists
potential dependents, not proven runtime failures or every affected consumer. Path lookup follows
edge direction for at most eight hops. `undirected: true` also walks edges backwards to find a
structural connection; that result is not a directional call trace. No path found does not prove the
two targets cannot connect.

## Read the coverage line

Structural lookup results include how much of the project the map could connect. Camera commands
report view state and confirmation instead. The map reads syntax, not types: a method called on a
value whose type the code does not state (`items.map()`, an un-annotated `client.send()`) is not
linked. So "used by: none" means none that the map could resolve — confirm with a text search before
telling the user something is unused or safe to delete.

Only supported TypeScript/TSX, JavaScript/JSX, Python and Go sources are mapped. Discovery skips
ignored files, symlinks, dependency/build directories, oversized files and minified sources, and
caps source discovery at 20,000 files. The omitted-file counter describes overflow past that cap; it
does not count every ignored or skipped file. Check indexing status and refresh errors before
treating a retained map as current.

## Walking the user through code

When the user is looking at the Code Graph tab (its published context names the level and the
selected node), explain from what they see and use the ids listed there. To point at something, call
`code_graph_show` with the nodes in the order you discuss them and a one-line `note`; the first node
is selected and the rest are highlighted. Do not call it for your own lookups.

Use `scope` in `code_graph_search` to narrow namesakes to a file or directory. Search accepts exact
ids and queries containing several words, each matched against name and path. For showing a precise
target, use the returned ids: `code_graph_show` refuses ambiguous or missing references.

`code_graph_show` with `mode: "lens"` opens up to six distinct declarations as source cards, in the
supplied order. `mode: "map"` shows their level and highlights them. Commands belong to this chat,
so a second chat in the same project keeps its own view. They never open the tab: when it is closed,
give the user the result's `App view` link.

`code_graph_view` with `kind: "inspect"` requests a fresh report from the visible tab: level, call
trail, selection, zoom, viewport and visible node ids. It can fall back to the stored report if no
new live answer arrives; do not assume every inspect result was measured at the instant of the call.
After showing a target, inspect to confirm it arrived. To move the current camera, use
`kind: "focus", nodes: ["id"]`, `kind: "fit"`, `kind: "zoom", zoom: 1`, `kind: "pan", x: 0.5, y: 0`,
or `kind: "area"` with `x`, `y`, `width` and `height`. Focus applies to nodes already drawn; use
show to navigate between levels. A move without the tab's matching report is queued, not confirmed.
Camera requests expire after 15 seconds.

This graph is derived from source files. Change source with file tools and let the index refresh; do
not treat nodes or edges as editable Project Space elements. Missing graph edges alone do not prove
that a declaration is unused.

See the [Code Graph guide](https://github.com/rsaryev/localix/blob/main/docs/features/code-graph.md)
for indexing and refresh limits.
