_Use: Lay things out on the project's spatial board (Project Space): map a feature or an
architecture with the project's real files, sketch a flow with shapes and connectors, collect notes,
or read what the user arranged. Use when the user asks to put something on the board, draw a
diagram, or talk through what is on it._

# Use the Project Space board

Project Space is one board per project, kept in the project at `.localix/project-space/space.json`.
It holds notes, text, shapes, frames, flowcharts, sequence diagrams, code snippets and connectors,
and LIVE references to the project's files, folders, images, documents and web links — a file
element shows the file as it is now and opens it.

## Read, then change

1. `space_read` gives the roster: `[id] type (x,y w×h)`, its marks, then `: text`; connectors
   follow. The marks are `in <frame>`, `group inner<outer` (the group ids other operations take),
   `locked` and `opacity N`; `— MISSING on disk` flags a reference whose file is gone. Narrow a
   large board with `frame`, `ids` or `query` (every word, in any order — the person's search on the
   board matches the same way). It names files by path; read them with your file tools — the board
   never holds a copy.
2. `space_apply` takes 1–200 operations, evaluated in order. A refused one is reported with the
   reason and changes nothing; other accepted operations remain in the batch's saved result. Fix
   only refused operations rather than resending successful ones. Accepted changes are persisted
   together in one board write; per-operation acceptance is not a separate disk commit.

| Operation    | Use it to                                                                         |
| ------------ | --------------------------------------------------------------------------------- |
| `create`     | add an element; give it an `id` to connect or group it in the same batch          |
| `update`     | move, resize, relabel (`text`), `props`, `locked`, `opacity`; `type` changes kind |
| `connect`    | draw a connector `from` → `to`, with an optional `label`                          |
| `edge`       | restyle a connector (`label`, `labelAt`, `route`, caps, `stroke`, `weight`)       |
| `delete`     | remove an element (its connectors go too) or a connector                          |
| `arrange`    | lay `ids` out as a `row`, `column` or `grid`; with `in`, a frame's contents       |
| `align`      | line `ids` up on an edge: `left`, `center`, `right`, `top`, `middle`, `bottom`    |
| `distribute` | equal gaps between three or more `ids`, `horizontal` or `vertical`                |
| `group`      | make `ids` one group (`ungroup` takes the group id apart)                         |
| `order`      | stack `ids`: `front`, `forward`, `backward` or `back`                             |

Wherever `ids` are taken, a group id stands for all its members, and a group moves, aligns and
stacks as one piece. To turn an element into another kind (a note into a shape, a `mermaid`
flowchart into a native `flow`), `update` it with `type`: it keeps its id, place, stacking, groups
and connectors, and its props start from the new kind's defaults.

## Place without coordinates

Omit `x`/`y` and say where it belongs: `in` a frame, or `near` an element. A free spot is found, so
placement is automatic. A full frame can fall back to a position that overlaps existing content;
resize the frame or arrange its contents rather than assuming collision-free placement. For a tidy
layout do not compute positions: create the elements, then `arrange` them (`in` a frame lays out
what it holds and fits the frame around it), `align` or `distribute` them. Give coordinates only
when the layout is not a row, column or grid: x grows right, y grows down, a note is 200×200.

## Layers

The roster lists elements bottom to top. Frames are always drawn beneath everything else, so nothing
goes "behind" a frame: a frame's background picture is an `image` created `in` the frame with
`props.fit: "cover"`, `x`/`y`/`w`/`h` of the frame, `order` `back` and `locked: true` — a locked
element lets the pointer through, so the person draws on top of it. `opacity` (0.05–1) fades an
element that should recede. A locked element changes only in an update that also passes
`locked: false`.

## Pick the element that IS the thing

- **A sequence** (who calls whom, in order) is ONE `sequence` element: pass `text` as Mermaid —
  `sequenceDiagram`, `actor User`, `participant Web as Web UI`, `database DB`, then
  `User->>Web: create` (a call), `Web-)Queue: event` (async), `API-->>Web: 201` (a return). It draws
  lifelines and keeps every message on its own row; boxes plus a text list of arrows is not a
  diagram. This native editor accepts a sequence subset; use a `mermaid` element with `props.source`
  for complete Mermaid definitions, including branches and loops. Unsupported lines in the native
  sequence parser can be skipped, so read the saved result back.
- **A flowchart or an architecture** (steps, decisions, services, stores) is ONE `flow` element:
  pass `text` as a Mermaid `flowchart` — `flowchart LR`, `A[Plan] --> B(Build)`,
  `B -->|ok| C{Ready?}`, `C -.->|no| D[(DB)]`, `subgraph api [API] … end`. It lays itself out with
  right-angled lines; mark one or two key steps `:::focal` (also `:::store`, `:::external`,
  `:::optional`); `<br/>` starts a technical sublabel (`api[API<br/>hono:5151]`). `props.direction`
  and `props.spacing` (`narrow`, `regular`, `wide`) restyle it without rewriting it. A line this
  native reader cannot draw is refused with its line number, so fix it or use a `mermaid` element.
- **A prioritisation** (impact against effort, reach against confidence) is ONE `quadrant`: pass
  `text` as a Mermaid `quadrantChart` with `x-axis Low effort --> High effort`,
  `y-axis Low impact --> High impact`, `quadrant-1`…`quadrant-4` (top right, top left, bottom left,
  bottom right) and one `Item: [x, y]` per line in 0–1. Mark the one or two items the matrix is
  about `Item:::focal: [x, y]`. The person drags items; read the props back before you reason about
  where they now sit.
- **Free-form shapes** joined by `connect` are for a diagram the person will rearrange by hand or
  whose steps link to files: `kind` `rounded` for a step, `diamond` for a decision, `ellipse` for
  start and end, `cylinder` for a database, `document`, `cloud`. A `flow` can be turned into such
  shapes later (Convert to shapes), not back.
- **Connectors** carry a `label`, a `route` (`curved`, `straight`, `elbow`), caps `start`/`end`
  (`none`, `arrow`, `triangle`, `circle`, `diamond`, `bar`), a `stroke` (`dashed` for a return or an
  optional path), a `weight` (`thin`, `regular`, `bold`) and a `color`. The label is drawn beside
  the line, never on it; `labelAt` (0–1, the middle by default) slides it along the line when a node
  crowds it.

## Write and set text

Notes, shape labels and text elements draw light Markdown from their plain text: `**bold**`,
`*italic*`, `++underline++`, `~~strike~~`, `==highlight==` and `` `code` ``. A note also draws one
block per line: `# heading`, `- bullet`, `1. step`, `- [ ] task` (the person ticks it on the board)
and `> quote`. Write the marks; the text stays readable in the board file and to you.

How text is set is props, the same on every type that has text:

| Prop     | Values                                     | On                      |
| -------- | ------------------------------------------ | ----------------------- |
| `font`   | `sans`, `serif`, `mono`, `hand`            | note, shape, text       |
| `align`  | `start`, `center`, `end`                   | note, shape, text       |
| `valign` | `top`, `middle`, `bottom`                  | note, shape             |
| `ink`    | a colour name (absent is the theme's ink)  | shape, text             |
| `size`   | `auto` fits the text to the note (default) | note: `auto`, `sm`…`xl` |

Keep faces purposeful: `sans` for names, `mono` only for technical values (ports, commands, paths),
`serif` for a title, `hand` for an aside. A shape label is a name and an optional second line in
code, as `text: "**Build**\nbun run build"` with the second line wrapped in backticks.

## Draw so it reads

A diagram is done when nothing more can be taken out. Before you draw, decide what is focal.

- At most about nine shapes in one frame; more is two diagrams, an overview and a detail.
- Colour one or two focal elements (the path that matters, the component that changed); keep the
  rest `gray`. Colour on every shape erases the signal.
- Use `route: "elbow"` for flows and architectures; curves for loose association only.
- A connector label is one to three words (`reads`, `on 401`, `retry`). If the relationship is
  obvious from the layout, leave the label out.
- `dashed` means optional, async or a return; `bold` the headline path.
- Lay out with `arrange`, `align` and `distribute`, left to right or top to bottom, never by
  guessing coordinates.

## Reference, never paste

- A file of the project is a `file` element with `props.path` (project-relative). Do not copy its
  content into a note or a code element — the file element stays current.
- A folder is a `folder`, an image an `image`, a PDF or Office file a `document`, a URL a `link`.
- `code` is for a snippet that exists nowhere else (a proposal, an example).
- Anything else the app can link is a `ref` (an app link) with the chat's own token:
  `{ "op": "create", "type": "ref", "props": { "kind": "call", "token": "@call:<toolCallId>" } }`.
  Kinds: `session` (`@session:LOCALIX-42`), `message` (`@message:<sessionId>/<messageId>`), `call`,
  `terminal`, `project`, `resource` (`@resource:localix://resource/<provider>/…`). The card draws
  the thing live — a call is its transcript card — so put the tool call that found the bug on the
  board instead of retelling its output in a note. A call from another session also needs
  `attributes.sessionId`.

## Show it and look at it

`space_view` moves the camera of the board the person is looking at, and answers with what the view
then shows when the visible tab returns a matching report — the rectangle, zoom and elements. If the
tab does not answer, the result says the move was sent but unconfirmed; do not claim the person saw
it. Nothing opens the tab for you: when it is closed, give the user the result's `App view` link.
One call, one move:

Confirmation waits up to 2.5 seconds for a listening tab, or six seconds while it is still opening.
A pending camera command is retained for 15 seconds; no matching report means the visible result is
unproved. View rosters summarize beyond 40 elements, and ordinary `space_read` summarizes beyond
150; narrow by frame or IDs when details matter.

| Input              | Does                                                            |
| ------------------ | --------------------------------------------------------------- |
| `focus: ["id", …]` | one id zooms INTO that element (up to 125%); several fit whole  |
| `area: {x,y,w,h}`  | frames a board rectangle                                        |
| `fit: true`        | frames the whole board                                          |
| `zoom: 0.1–2.5`    | with the above, pins the zoom; alone, zooms about the centre    |
| `pan: {x, y}`      | slides by fractions of the view: `{x: 0.5}` half a screen right |

What you focus glows for a moment on the person's screen, and every move is on their camera's
history (⌥← takes them back), so walk them through a board with it — "here is the checkout flow",
then `focus` the next frame — instead of describing coordinates. Its answer is the cheap way to
check what is on screen; take a picture only when how it LOOKS matters: open `Browser`
`{ "action": "open", "url": "mini-app:project-space" }`, then `take_screenshot`. There is no
`http://` address for the board.

## Map something

Make a frame per area (`text` is its title), put the file elements `in` it, `arrange` each frame
(`layout: "grid"`), then `arrange` the frames themselves in a row, and connect what calls or depends
on what. Label connectors with the relation ("calls", "reads", "emits"). Read the board back once at
the end and tell the user what you laid out.
