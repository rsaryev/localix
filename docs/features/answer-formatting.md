# Answer formatting

Agent replies in the transcript render as GitHub-flavored Markdown with math, callouts, attributed
quotes, captioned figures and diagrams. Use this page to know what an answer can contain and why the
agent chooses one form over another.

**Scope:** The system prompt describes these constructs only to chat runs whose reply is read in the
Localix transcript. Channel sessions, sub-agents and automations are not told about them.

## System events in replies

System events received during a reply keep their arrival anchors and appear between the agent's
explicit output blocks. Text, code and reasoning are never cut at a character offset. Ordinary
events received in a growing text or reasoning block wait until that block closes or the next output
block starts; a quiet line shows how many events were received. Warnings, errors and events with
recovery actions are visible immediately after the current block.

Each new hook or terminal event records its local reception time, shown beside its system line.
Events at the same boundary retain their arrival order. Completion does not reposition events that
were already shown. Flat replies without item boundaries keep their text whole; events received
before the text stay before it, and other events follow it. Events after a completed reply remain
separate timeline rows.

## Terminology

| Term    | Meaning                                                               | Boundary                                                 |
| ------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| Callout | A quote whose first line is a `[!KIND]` marker, drawn as a quiet note | Uses GitHub's alert kinds; any other kind stays a quote  |
| Source  | A quote's closing line that starts with `— ` or `-- `                 | Only the closing line; a dash mid-sentence is left as is |
| Figure  | An image alone in its paragraph, centred and bounded in size          | Captioned by its title or an emphasis-only line under it |
| Diagram | A fenced block labelled `mermaid`, drawn as SVG once its fence closes | Shown as a pending frame while its fence is written      |

## What you can do

| Construct   | Markdown                                                  | Rendered as                                           |
| ----------- | --------------------------------------------------------- | ----------------------------------------------------- |
| Callout     | `> [!WARNING]` then the body lines in the same quote      | A faint note with the kind's glyph in its status hue  |
| Titled note | `> [!TIP] Faster builds` on the marker line               | The same note, with the text after it as a bold title |
| Quote       | A quote whose last line is `> — Ada Lovelace`             | The quotation with its source set right, below        |
| Figure      | `![Queue](queue.png "Figure 1: the wake queue")`          | A centered image with its caption underneath          |
| Caption     | A lone image, then `*The wake queue*` on the next line    | The same figure, captioned by that line               |
| Section no. | `## 1.2 Water temperature`                                | The number set quieter than the title                 |
| Steps       | `> [!STEPS]` over a list of `**Title**`, `*when*`, text   | A vertical timeline: a dot per step on a dotted line  |
| Tabs        | `> [!TABS]` with a `#### Label` heading per variant       | One panel per variant, one shown at a time            |
| Figures     | `> [!STATS]` over `- **3×** faster builds` items          | A wrapping row of headline numbers with labels        |
| For/against | `> [!PROS]` list, then `> [!CONS]` list                   | Two side-by-side cards, a check or cross per point    |
| File tree   | A `tree` fence holding `├──` / `└──` lines                | Rows with folder and file glyphs, comments set quiet  |
| Checklist   | `- [ ] item` / `- [x] item`                               | Boxes the reader ticks; marks are kept on the message |
| Reply title | A reply whose first block is a `#` heading                | That heading centred, as a document title             |
| Diagram     | A `mermaid` fence holding `flowchart`, `sequenceDiagram`… | An SVG in the app's colours, with hover controls      |
| Table       | Any GFM table                                             | Horizontal rules only, no cell grid or header fill    |

A callout accepts `NOTE`, `TIP`, `IMPORTANT`, `WARNING` and `CAUTION` in any letter case. The source
stays plain Markdown, so a copied answer still reads correctly on GitHub or in a plain text editor.

The agent can use flowcharts, sequences, state machines, class and entity diagrams, mindmaps,
timelines, Gantt schedules and git graphs. Quantitative views include line/bar (`xychart-beta`),
pie, radar (`radar-beta`), treemap (`treemap-beta`), Sankey (`sankey-beta`) and quadrant charts. The
prompt encourages a focused visualization when it helps explain the answer, with supplied data or
explicitly labelled illustrative data. Unsupported chart types are not advertised as rendered
capabilities. These views share the same enlarge, source and copy controls and theme colours.

```text
> [!WARNING]
> Rotating the key signs every client out.
```

Steps are for a sequence read in order — the phases of a recovery, a schedule, a procedure. Each
list item opens with its title in bold; an italic line under it (or after `—` on the same line) says
when, and the rest is the step's text. Text after the marker titles the whole timeline. An ordinary
bold-led list stays a list: only the marker makes a timeline, because `**Pros:** …` lists are far
more common than timelines. The prompt makes Steps the default for any staged answer, ahead of the
numbered list a model writes by habit, and steers diagrams to branching flows, structure and data.

```text
> [!STEPS] Restore a workspace
> 1. **Inspect the backup**
>    *Before restoring*
>    Check the saved files and choose the version to restore.
> 2. **Verify the result**
>    *After restoring*
>    Open the workspace and check the files you need.
```

The other container forms follow the same rule: a marker of ours over ordinary Markdown, so the
source still reads as a quote holding a list or sections anywhere else. **Tabs** split on the first
heading level under the marker. The first panel opens initially; switch tabs to read the other
variants. Hidden panels remain mounted, and copying the whole message retains their Markdown.

**Figures** take each item's bold lead as the number. **For/against** pairs a `PROS` and a `CONS`
written one after the other into one block. A comparison of options is a tab per option holding its
pros and cons; the prompt keeps tables for exact values read across options, such as specs, prices
and limits. A form whose content does not fit — a `TABS` with no heading, a `STATS` with no list —
stays a quote.

Models often write the marker as a quote on its own line and the content after it unquoted. A quote
that holds only the marker therefore governs the blocks right after it. A list form takes the one
list that follows. Tabs take the run of sections starting at the heading that follows, and the run
ends at a shallower heading, a `---` or the end of the reply. If nothing of the right shape follows,
the marker stays a quote.

A **file tree** is a fence the model already draws; naming it `tree` is the whole opt-in. A row is a
folder when its name ends in `/` or the next row is deeper, and text after `#` is its comment. The
tree uses the Files sidebar's file-type icons and indent guides. A folder folds on click, Enter or
Space, and the arrow keys move between rows.

A **checklist** is GFM's own task list. In an agent's reply each box can be ticked, and the mark is
stored on the message — the same in every window and after a reload — keyed by where the item sits
in the text. The agent's words never change, and the marks are never sent to the model. Checkmarks
appear immediately; a failed server save restores the prior state and shows an error. A checklist
added to Project Space can be ticked there too: there the text is the store, so a tick changes the
item's `[ ]` to `[x]` in the element's Markdown, and undo takes it back.

```text
> [!TABS]
> #### macOS
> sw_vers
> #### Linux
> cat /etc/os-release
```

## How it works

### One shared dialect

`packages/markdown/src/dialect.ts` owns the callout kinds, container forms, fence languages and
source-line prefix. The agent prompt, workspace and documentation share that grammar. The API's
`answer-markdown.ts` re-exports the contract for existing consumers.

`agent-core/prompt/sections/answer-format.ts` renders `# Answer formatting` in the cached prompt
prefix. It also sets the shape rules: plain prose for a short reply, a heading per thread for a long
one, a tab per compared option and a table for exact values. It sits before the user's response
style preferences, which override it.

### Rendering

`remarkAnswerBlocks` re-labels nodes the Markdown parser already produces. It does not emit raw
HTML, so the sanitize pipeline gains nothing new to trust. It runs while a reply streams too, so a
callout does not re-flow the message when the reply settles. A marker still being typed, such as
`> [!WARN`, is withheld by the streaming stabilizer until its `]` arrives.

Math is typeset while a reply streams. `rehypeMathCached` keeps recently typeset formulas in a
bounded cache, so repeated expressions can reuse their rendered nodes until eviction. The stabilizer
withholds a formula from its opening `$` until the closing one arrives; a currency amount such as
`$5` and a shell variable such as `$HOME` are left as text.

Math, code highlighting, diagrams, and inspector snapshots each use a bounded cache built with the
shared cache utility. Reusing a formula avoids repeated typesetting, but the time saved depends on
the content and device.

The styling follows the visual system: a callout's kind is carried by its glyph in the status hue,
never by a coloured fill, and the note itself is a veil of the foreground over its ground. An
untitled callout prints no kind name, so an English label never sits over a reply in another
language; assistive technology still announces the kind.

`StreamingDiagram` draws a `mermaid` fence as soon as its closing fence arrives, even while the
reply keeps streaming. Only the fence still being written, which is always the last one, shows a
pending frame (`openFenceBody` in `markdown-stream.ts`). `mermaidLook.ts` resolves the app's colour
tokens into a Mermaid `base` theme, so a diagram matches the palette in use. **Show source** swaps
the diagram for the transcript's standard code block, highlighted by the Mermaid grammar in
`mermaidGrammar.ts`, with **Show diagram** in that block's own toolbar. The renderer runs one
diagram at a time in Mermaid's `strict` security level and caches each SVG by source and colours.

Identical requests share one layout. When a transcript row unmounts or changes its source, it
releases its request; a queued layout with no readers is dropped before drawing. The cache holds at
most 64 diagrams and 8 million characters of source keys and SVG, so large diagrams also count
toward its memory budget.

Click a diagram or its **Enlarge diagram** control to open a large viewer. Drag or scroll to pan;
pinch or use the zoom controls to enlarge. **100%** restores reading scale and **Fit everything**
shows the whole diagram. Long chains open at reading scale from their beginning. Escape or the close
button returns to the reply. The viewer reuses the rendered SVG and the shared graph camera.

The viewer adapts to the diagram's dimensions and available viewport. It reuses the rendered SVG
rather than computing another Mermaid layout.

When Project Space is enabled, **Add to Project Space** appears on settled reply fragments:
headings, paragraphs, lists, quotes, callouts, formulas, tables, code, diagrams, images and links.
Mermaid becomes an editable diagram with its exact source; code and tables use the board's native
elements. File trees offer the action on the tree itself and keep the exact `tree` fence. Other text
keeps its Markdown, including complete steps, tabs, figures and pros/cons. These forms use the same
renderer on the board, with folding, tab switching and tickable checklists. A table the native
parser cannot represent is kept as Markdown. The action also appears in the enlarged diagram viewer.
Each placement can be moved, resized and undone on the originating chat's project board.

Generated Localix images and inline image attachments are saved beside the board. External images
remain HTTP/HTTPS references; an explicit image link with a recognised image extension becomes an
image, and other web links become link cards. File links retain their path and, for file cards, line
number. Remote image references still depend on the original URL remaining available.

Actions are plugin contributions through the SDK's optional `actions` registry. The host supplies
`{ sessionId, surface, target }`; a target identifies code, visualization, Markdown, table, image,
link or file content. The plugin's synchronous `when(context)` decides visibility and its
`run(context)` owns persistence and destination navigation. Disabled or unloaded plugins offer no
action. Streaming content is not offered for transfer. The transcript imports no concrete
destination plugin.

## Limits

- Mermaid loads the first time a reply contains a complete diagram, so that first diagram appears
  after a short delay.
- A diagram that fails to parse stays readable code with the parser's first error line below it.
- Diagram colours are resolved when the theme changes. Switching palette within the same light or
  dark mode repaints a diagram only when its row mounts again.
- Only a title typed on the marker line itself is used. When that line holds inline formatting, the
  line becomes body text and the callout has no title.

The documentation uses the same parser. See [Shared Markdown](../extending/markdown.md) for live
examples and package entry points.

## Related guides

- [Conversations](conversations.md)
- [Sessions and projects](sessions-and-projects.md)

## Source of truth

- [The answer dialect](https://github.com/rsaryev/localix/blob/main/packages/markdown/src/dialect.ts)
- [The prompt section and its gate](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/prompt/sections/answer-format.ts)
- [Callout, source and figure parsing](https://github.com/rsaryev/localix/blob/main/packages/markdown/src/remarkAnswerBlocks.ts)
- [Steps, tabs, figures and for/against](https://github.com/rsaryev/localix/blob/main/packages/markdown/src/remarkAnswerContainers.ts)
- [File trees](https://github.com/rsaryev/localix/blob/main/packages/markdown/src/fileTreeParse.ts)
- [Tickable checklists](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/ui/MarkdownTaskList.tsx)
- [Callout rendering](https://github.com/rsaryev/localix/blob/main/packages/markdown/src/MarkdownBlockquote.tsx)
- [Diagram queue and cache](https://github.com/rsaryev/localix/blob/main/packages/markdown/src/renderMermaid.ts)
- [Diagram colours from tokens](https://github.com/rsaryev/localix/blob/main/packages/markdown/src/mermaidLook.ts)
- [Drawing diagrams while a reply streams](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/ui/mermaid/StreamingDiagram.tsx)
- [Cached math typesetting](https://github.com/rsaryev/localix/blob/main/packages/markdown/src/rehypeMathCached.ts)
- [The shared bounded cache](https://github.com/rsaryev/localix/blob/main/packages/kit/src/lib/bounded-cache.ts)
