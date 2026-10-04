# Code Graph

Code Graph is a navigable map of a chat's project: directories, files and symbols joined by their
imports, calls and inheritance. Use it to orient in an unfamiliar codebase, to see what depends on
something before you change it, or to follow how one part of the code reaches another.

## Terminology

| Term    | Meaning                                                                      | Boundary                                                         |
| ------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Node    | A directory, file, class, interface, type, enum, function, method or package | A package is a dependency outside the project; it has no parent. |
| Edge    | `imports`, `calls`, `extends` or `implements` between two nodes              | Every edge carries the line of its first occurrence and a count. |
| Level   | One directory's children, or one file's top-level symbols, drawn as boxes    | Every edge in the project is lifted to the level being viewed.   |
| Portal  | A dashed box for code outside the level that the level's children reach      | It stands for the part of the tree the edge leads into.          |
| Node id | `dir:<path>`, `file:<path>`, `sym:<path>#<Qualified.name>`, `pkg:<name>`     | Paths are project-relative, so ids do not depend on the machine. |

## What you can do

| Operation               | How                                                                       | Boundary                                                         |
| ----------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Open the map            | **Code Graph** in the rail overflow, or ask the agent about the code      | One map per chat; it maps the chat's project directory.          |
| Move between levels     | Click a folder or file once; use the breadcrumb to climb to an ancestor   | A folder shows up to 6 of its children inside it.                |
| Revisit a place         | Use Back and Forward beside the breadcrumb, or Alt+← and Alt+→            | Restores the level, selection and call trail.                    |
| Move the camera         | Scroll or two fingers pan; pinch or ⌘/Ctrl + scroll zoom; Shift+1 fits    | Large levels open at reading scale; Shift+0 or the % shows 100%. |
| Inspect a node          | Select it from search or open its level, then show the inspector          | It lists what uses the node and what the node uses.              |
| Read code               | Click a function, class, type or constant: the call lens shows its code   | A card shows up to 300 lines; the rest opens in the editor.      |
| Follow a name           | Click an underlined name in a card: its definition opens as the next card | Calls underline solid, other names dotted; up to 6 cards.        |
| Climb out               | A card's header path: its file shows on the map, a class opens its card   | The toolbar path folds its middle steps into a menu.             |
| Read a level            | With nothing selected the inspector describes the folder you are in       | Hotspots and import cycles are those under that folder.          |
| Find a symbol           | `/` focuses search; it ranks exact names first, then what more code uses  | Matching is lexical over names and paths.                        |
| Filter                  | The filter menu toggles edge kinds and dependencies outside the project   | Filters change what is drawn, never the layout.                  |
| Open the source         | **Open** in the inspector opens the file at the symbol's line             | —                                                                |
| Share it with the agent | Automatic: the tab publishes the level and selection as the chat context  | Replaced on every move, cleared when the tab is not in view.     |

In a code card, drag over the source to select text and copy it with ⌘C/Ctrl+C. The **Copy code**
button in the header copies the visible source without line numbers or navigation labels. If the
card is truncated, open the source in the editor to access the remaining lines.

The agent can narrow `code_graph_search` to a file or directory with `scope`. Showing a target with
`code_graph_show` requires unambiguous references; `mode: "lens"` opens up to six declaration cards,
while `mode: "map"` highlights nodes at their level. Each chat controls its own tab.

`code_graph_view` reads the visible tab's level, call trail, selection, zoom and visible node ids.
It can focus drawn nodes, fit the board, zoom, pan by screen fractions, or frame a board rectangle.
The tab confirms a move with its actual camera; if it does not answer, the tool reports an
unconfirmed request. Camera requests expire after 15 seconds. The visible-node report is bounded to
200 ids, with up to 50 described in a tool response. The graph remains derived from source: editing
files updates it, while camera commands change only the view.

At rest, the map groups connections between containers and shows the strongest links. Hover or
select a box to trace its direct connections. The small count on the canvas says when more
connections exist than can be drawn clearly; the inspector and agent tools still query the full
graph. Each level draws up to 64 children, and a container previews up to 6 of its children. Open
the container to see its own level, or use search for a child omitted from a crowded level.

The agent reads the same graph through six tools, and every result prints node ids the other tools
accept:

| Tool                  | Answers                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `code_graph_overview` | What is at this level, what depends on what, hub files and import cycles.  |
| `code_graph_search`   | Where a class, function, file or directory is.                             |
| `code_graph_node`     | What a node imports, calls, extends — and what imports, calls, extends it. |
| `code_graph_impact`   | What depends on a node transitively, grouped by file (the blast radius).   |
| `code_graph_path`     | The shortest chain of edges from one node to another.                      |
| `code_graph_show`     | Points the person's map at nodes, with a highlight and a one-line note.    |

## How it works

1. **Discovery** walks the project in-process and honours every `.gitignore`, the repository's
   `.git/info/exclude` and the global excludes file (`core.excludesFile`, else
   `~/.config/git/ignore`), so it needs neither git nor ripgrep. Dependency and build directories
   (`node_modules`, `dist`, `.venv`, …) are always skipped. An open map hears file changes in the
   chat's project and re-indexes about a second and a half after them; edits under skipped
   directories and `.git` do not trigger a walk.
2. **Extraction** parses each file with tree-sitter compiled to WebAssembly and records its symbols,
   imports, call sites and bases. A file whose size and modification time are unchanged is not read
   again; a changed file is hashed, and only new content is parsed.
3. **Resolution** rebuilds every cross-file edge from the cached extractions: module specifiers
   through relative paths, tsconfig `paths`, workspace packages, Python package roots and `go.mod`
   module paths; names through imports, re-exports and star imports; member calls through `this`,
   `self`, a Go method's receiver, and types the source states (typed parameters, `new X()`, typed
   fields).
4. **Publishing** freezes the graph and replaces the previous one, and tells the open tab, which
   reads one snapshot that carries only the level on screen. The agent's requests and its camera
   questions reach the tab the same way, over the realtime socket; a slow poll remains as a backstop
   for a remote session or a dropped connection.
5. **The call lens** reads a declaration's source when it is shown, not from the index, and marks
   each resolved name at its token: calls, and every other use of a project declaration — a type in
   an annotation, a constant, `ns.helper`. A name declared locally (a parameter, a destructured
   variable) shadows a module name and is never linked. A card whose file changed since it was
   indexed says so until the refresh realigns its links.

A name that could mean two declarations produces no edge. A call on a value whose type the source
does not state (`items.map()`, `client.send()` without an annotation) stays unresolved, and every
answer reports how many calls were linked, went into dependencies, or stayed unresolved.

## Configuration

| Setting         | Where                                | Effect                                                        |
| --------------- | ------------------------------------ | ------------------------------------------------------------- |
| Ignored files   | `.gitignore`, `info/exclude`, global | Ignored paths are never indexed.                              |
| Path aliases    | `tsconfig.json` / `jsconfig.json`    | `paths` and a declared `baseUrl` resolve aliased imports.     |
| Workspace names | `package.json` `name` and `exports`  | Imports of a workspace package resolve to its source files.   |
| Go modules      | `go.mod`                             | Import paths under the module resolve to project directories. |
| Cache           | `~/.localix/plugin-data/code-graph/` | One SQLite extraction cache per project; safe to delete.      |

## Limits

- Languages: TypeScript, TSX, JavaScript, Python and Go.
- At most 20,000 source files per project are indexed; files over 1 MB and minified files are
  skipped, and the view says how many were left out.
- Resolution is syntactic. It does not infer return types, generics or dynamic dispatch, so an
  absent "called by" is not proof that nothing calls a symbol.
- Parsing runs in the API process and yields to the event loop every few milliseconds; a first index
  of a large project takes seconds, later refreshes re-parse only changed files.
- Four projects stay warm in memory; the least recently used one is released past that.

## Related guides

- [Plugins](../extending/plugins.md) — how bundled plugins are installed and trusted.
- [Language servers](lsp.md) — per-file diagnostics and navigation in the editor.
- [Source control](source-control.md) — the changes you are about to make.

## Source of truth

- [Tree-sitter loading and the per-language extractors](https://github.com/rsaryev/localix/blob/main/plugins/code-graph/backend/extract/)
- [Build phases and resolution statistics](https://github.com/rsaryev/localix/blob/main/plugins/code-graph/backend/graph/build.ts)
- [Name, export, member and field-type lookup](https://github.com/rsaryev/localix/blob/main/plugins/code-graph/backend/graph/scope.ts)
- [Lifting edges to a level and building portals](https://github.com/rsaryev/localix/blob/main/plugins/code-graph/backend/graph/view.ts)
- [The refresh job and the extraction cache](https://github.com/rsaryev/localix/blob/main/plugins/code-graph/backend/indexing/project-index.ts)
- [The agent tools](https://github.com/rsaryev/localix/blob/main/plugins/code-graph/backend/tools.ts)
