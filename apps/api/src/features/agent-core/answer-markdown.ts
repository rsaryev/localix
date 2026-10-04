/**
 * The answer dialect: what the Localix transcript renders beyond GitHub-flavored Markdown.
 *
 * Two readers depend on the same facts. The system prompt tells the model which constructs it
 * may write (`system-prompt-answer-format-section.ts`), and the UI renderer turns them into
 * callouts, attributed quotes, captioned figures and diagrams
 * (`apps/ui/src/shared/ui/remarkAnswerBlocks.ts`). A separate copy on each side is how a prompt
 * ends up advertising a construct the renderer prints as raw `[!TIP]` text, so both import this
 * leaf — and it therefore stays free of server imports (the browser bundles it).
 */

/**
 * Callout kinds, in GitHub's alert syntax (`> [!WARNING]`). GitHub's own set, not an invented
 * one: the model already writes it, and an answer pasted into an issue or a README keeps its
 * rendering there.
 */
export const CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const
export type CalloutKind = (typeof CALLOUT_KINDS)[number]

/** Fence language whose body renders as a diagram rather than as code. */
export const DIAGRAM_FENCE_LANGUAGE = 'mermaid'

/**
 * Diagram types worth naming to the model. Mermaid parses more; these are the ones that read
 * well at chat width, so the prompt steers toward them instead of listing the whole grammar.
 */
export const DIAGRAM_KINDS = [
  'flowchart',
  'sequenceDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'gantt',
  'pie',
  'xychart-beta',
  'classDiagram',
  'mindmap',
  'timeline',
  'quadrantChart',
  'sankey-beta',
  'radar-beta',
  'treemap-beta',
  'gitGraph',
] as const

/**
 * A quote's closing source line: `— Author` (em dash) or `-- Author` for keyboards without one.
 * Anchored at a line start, so a dash inside a sentence never turns into an attribution.
 */
export const ATTRIBUTION_PREFIX = /^(?:—|--)[ \t]+/

const CALLOUT_MARKER = /^\[!([A-Za-z]+)\][ \t]*/

export interface CalloutMarker {
  kind: CalloutKind
  /** Text after the marker on its own line (`> [!TIP] Faster builds`), or '' for none. */
  title: string
  /** Characters of the input the marker and its title line consumed, newline included. */
  consumed: number
}

function isCalloutKind(value: string): value is CalloutKind {
  return (CALLOUT_KINDS as readonly string[]).includes(value)
}

/**
 * Read a callout marker at the start of a quote's first line.
 *
 * An unknown kind (`[!FOO]`) is not a callout: it stays a quote with its text intact, which is
 * also what GitHub does, so a typo degrades to readable text instead of a mislabelled box.
 */
export function parseCalloutMarker(text: string): CalloutMarker | null {
  const match = CALLOUT_MARKER.exec(text)
  if (!match) return null
  const kind = match[1].toLowerCase()
  if (!isCalloutKind(kind)) return null
  const rest = text.slice(match[0].length)
  const lineEnd = rest.indexOf('\n')
  const title = (lineEnd === -1 ? rest : rest.slice(0, lineEnd)).trim()
  const consumed = match[0].length + (lineEnd === -1 ? rest.length : lineEnd + 1)
  return { kind, title, consumed }
}

/**
 * CONTAINER FORMS: a quote opened by a marker of ours, over ordinary Markdown, that the renderer
 * lays out as something a plain list or heading cannot be.
 *
 *   steps   a list of stages read in order → a vertical timeline (dot, title, quiet "when", text)
 *   tabs    `#### Label` sections → one panel per variant (an OS, a language), one shown at a time
 *   stats   a list of `**value** label` items → a row of headline figures
 *   pros    a list → the case for, with a check per point
 *   cons    a list → the case against; right after `pros` the two sit side by side
 *
 * Opt-in by marker, never guessed from shape: models open MANY list items with bold
 * (`**Pros:** …`) and section with headings, and turning each of those into a widget would be
 * wrong far more often than right. In the quote they stay plain Markdown — a quote holding a list
 * or sections — so an answer still reads anywhere this dialect is not rendered.
 */
export const CONTAINER_KINDS = ['steps', 'tabs', 'stats', 'pros', 'cons'] as const
export type ContainerKind = (typeof CONTAINER_KINDS)[number]

/** The marker as the prompt writes it: `[!STEPS]`, `[!TABS]`, … */
export const containerMarker = (kind: ContainerKind) => `[!${kind.toUpperCase()}]`

/**
 * The prompt's example of each container form, kept here so the renderer's tests render the very
 * text the model is shown — an example that drew as stray markers would teach the model a broken
 * form. Each is written the way models write these forms: the marker alone as a one-line quote,
 * the content unquoted after it (the renderer reads that by grammar, `remarkAnswerContainers`).
 * Shown, not described: the markers are ours and absent from any training data, and a model that
 * was only TOLD about a form kept writing the table or numbered list it writes by habit.
 */
export const ANSWER_FORM_EXAMPLES = {
  comparison: [
    `> ${containerMarker('tabs')}`,
    '#### PostgreSQL',
    `> ${containerMarker('pros')}`,
    '- concurrent writes',
    '',
    `> ${containerMarker('cons')}`,
    '- needs a server',
  ],
  verdict: [
    `> ${containerMarker('pros')}`,
    '- typed APIs',
    '',
    `> ${containerMarker('cons')}`,
    '- a build step',
  ],
  steps: [
    `> ${containerMarker('steps')}`,
    '1. **First 24 hours**',
    '   *Day 1*',
    '   Rest and keep warm.',
  ],
  stats: [`> ${containerMarker('stats')}`, '- **3×** faster installs', '- **−40%** memory'],
} as const satisfies Record<string, readonly string[]>

function isContainerKind(value: string): value is ContainerKind {
  return (CONTAINER_KINDS as readonly string[]).includes(value)
}

export interface ContainerMarker {
  kind: ContainerKind
  /** Text after the marker on its own line (`> [!STEPS] Recovery`), or '' for none. */
  title: string
  /** Characters of the input the marker and its title line consumed, newline included. */
  consumed: number
}

/** Read a container marker at a quote's start. An unknown kind is not one (nor a callout). */
export function parseContainerMarker(text: string): ContainerMarker | null {
  const match = CALLOUT_MARKER.exec(text)
  if (!match) return null
  const kind = match[1].toLowerCase()
  if (!isContainerKind(kind)) return null
  const rest = text.slice(match[0].length)
  const lineEnd = rest.indexOf('\n')
  const title = (lineEnd === -1 ? rest : rest.slice(0, lineEnd)).trim()
  return { kind, title, consumed: match[0].length + (lineEnd === -1 ? rest.length : lineEnd + 1) }
}

/**
 * Fence language whose body is a directory layout (`├──` / `└──` lines) drawn as a file tree.
 * A fence the model already writes as `text`: naming it `tree` is the whole opt-in.
 */
export const TREE_FENCE_LANGUAGE = 'tree'
