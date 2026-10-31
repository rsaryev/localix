/**
 * Interactive-tree diffing for the actuator: a throwaway interactive-only snapshot
 * before/after an action, line-diffed into a compact "what changed" summary so the
 * agent sees the effect of a click/type without a separate snapshot round-trip.
 * Split out of actuate/index.ts.
 *
 * The diff baseline is NOT just the interactive tree — it also carries a cheap
 * DOCUMENT-STATE signature (html/body attributes + body colors). A theme toggle
 * flips `html[data-theme]` and every CSS color but leaves the interactive tree
 * untouched; diffing the tree alone would report "(no visible change)" and gaslight
 * the agent into thinking a WORKING click did nothing.
 * Folding document state into the baseline makes such changes visible. Short visible texts
 * (a score, a counter) are folded in for the same reason.
 */

import { buildSnapshot, type RefRegistry } from '../snapshot/index'
import { MAX_CHANGES, lcsDiff, tellChanges } from './diff-lines'

/**
 * Registry for the throwaway snapshots we build only to diff: it assigns no ref (keeping the live
 * ones valid) and records the elements in the order their lines are written, so a line of the
 * report can later be given the ref of its element.
 */
function recordingRegistry(sink: Element[]): RefRegistry {
  return {
    clear() {},
    put: (el) => {
      sink.push(el)
      return 'e0'
    },
    get: () => null,
    identityOf: () => null,
    findByIdentity: () => null,
    refOf: () => null,
    isEmpty: () => false,
  }
}

/** The element behind a line of the diff baseline; only `interactive` ones can be acted on. */
export interface LineElement {
  el: Element
  interactive: boolean
}

/** The diff baseline: its text, and per line (same order) the element it describes, if any. */
export interface DiffState {
  text: string
  refs: (LineElement | null)[]
}

/** The ref every line of a throwaway snapshot carries; comparing lines is then position-free. */
const DEAD_REF = ' [ref=e0]'

/** Pair each line that carries `DEAD_REF` with the next recorded element. */
function pair(lines: string[], els: Element[], interactive: boolean): (LineElement | null)[] {
  let next = 0
  return lines.map((line) => {
    const el = line.endsWith(DEAD_REF) ? els[next++] : undefined
    return el ? { el, interactive } : null
  })
}

/**
 * Cheap document-level state signature: html/body attributes (class, style, data-*,
 * lang, dir) plus the body's computed background/foreground color. Captures the
 * common theme mechanisms (`data-theme`, `class="dark"`, CSS-var restyles) so the
 * change-diff notices them even when the element tree is identical.
 *
 * Under a `root` the host's own html/body are not the target's state — the root is.
 */
function documentStateSignature(root?: Element): string {
  const lines: string[] = []
  for (const el of root ? [root] : [document.documentElement, document.body]) {
    if (!el) continue
    const tag = el.tagName.toLowerCase()
    const attrs: string[] = []
    for (const a of Array.from(el.attributes)) {
      if (
        a.name === 'class' ||
        a.name === 'style' ||
        a.name === 'lang' ||
        a.name === 'dir' ||
        a.name.startsWith('data-')
      ) {
        attrs.push(a.value ? `${a.name}="${a.value}"` : a.name)
      }
    }
    lines.push(`- ${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}`)
  }
  const body = root ?? document.body
  const view = body?.ownerDocument?.defaultView
  if (body && view?.getComputedStyle) {
    try {
      const cs = view.getComputedStyle(body)
      lines.push(`- viewport bg=${cs.backgroundColor} fg=${cs.color}`)
    } catch {
      /* getComputedStyle can throw on a detached view — skip the color line */
    }
  }
  return lines.join('\n')
}

// A short visible text: a score, a counter, a status line. They change while no control does —
// a game move only changes the score — and the diff called a working move "(no visible change)".
const SHORT_TEXT = /^- text "[^"]{1,40}"/

/** The structural + document-state signature used as the diff baseline, with its elements. */
export function captureState(root?: Element): DiffState {
  const docLines = documentStateSignature(root).split('\n')
  const treeEls: Element[] = []
  const tree = buildSnapshot(recordingRegistry(treeEls), {
    interactiveOnly: true,
    maxDepth: 30,
    root,
  }).tree.split('\n')
  const textEls: Element[] = []
  const all = buildSnapshot(recordingRegistry(textEls), { maxDepth: 30, root }).tree.split('\n')
  const allPaired = pair(all, textEls, false)
  const texts = all.flatMap((line, i) =>
    SHORT_TEXT.test(line.trim()) ? [{ line: line.trim(), ref: allPaired[i]! }] : [],
  )
  return {
    text: [...docLines, ...tree, ...texts.map((t) => t.line)].join('\n'),
    refs: [...docLines.map(() => null), ...pair(tree, treeEls, true), ...texts.map((t) => t.ref)],
  }
}

/** The text of `captureState`: what an action's report is diffed against. */
export function stateForDiff(root?: Element): string {
  return captureState(root).text
}

/** Lines of a baseline, trimmed and without blanks, each with its element. */
function linesOf(text: string, refs: (LineElement | null)[] = []) {
  return text.split('\n').flatMap((raw, i) => {
    const line = raw.trim()
    return line ? [{ line, ref: refs[i] ?? null }] : []
  })
}

/** Pages under this many lines are never read whole just for being shorter than the changes. */
const SHORT_PAGE = 10

/** What the model is told after an action: the ordered changes, or the page read whole. */
export type ChangeReport = { kind: 'diff'; text: string } | { kind: 'whole'; text: string }

/** Assigns (or finds) the live ref of an element, or none while no snapshot has run. */
export type RefFor = (el: Element) => string | undefined

/**
 * The ordered line diff of the page before and after an action: each change after the unchanged
 * line above it, `…` over gaps. `whole` when more than `MAX_CHANGES` lines changed, when telling
 * them would take more than the page, or when the pages are too long to compare.
 */
export function changeReport(
  prev: string,
  next: DiffState,
  refFor?: RefFor,
): ChangeReport | undefined {
  if (!prev) return undefined
  const after = linesOf(next.text, next.refs)
  const before = linesOf(prev)
  const show = (line: string, ref: LineElement | null) => {
    const text = line.replace(/^- /, '')
    if (!text.endsWith(DEAD_REF)) return text
    const bare = text.slice(0, -DEAD_REF.length)
    const live = ref?.interactive ? refFor?.(ref.el) : undefined
    return live ? `${bare} [ref=${live}]` : bare
  }
  const whole = (): ChangeReport => ({
    kind: 'whole',
    text: after.map((l) => show(l.line, l.ref)).join('\n'),
  })
  const lines = lcsDiff(
    before.map((l) => l.line),
    after.map((l) => l.line),
  )
  if (!lines) return whole()
  const changed = lines.filter((l) => l.kind !== 'kept').length
  if (!changed) return { kind: 'diff', text: '(no visible change)' }
  if (changed > MAX_CHANGES) return whole()
  const told = tellChanges(lines, (l) => show(l.text, l.kind === 'gone' ? null : after[l.at]!.ref))
  const text = told.join('\n')
  const pageSize = after.reduce((sum, l) => sum + l.line.length + 1, 0)
  // A short page is cheap to tell about whatever changed (and reads without the page's
  // document-state lines); only past `SHORT_PAGE` lines is the whole page the shorter way.
  const shorter = after.length >= SHORT_PAGE && text.length > pageSize
  return shorter ? whole() : { kind: 'diff', text: annotateDiff(text) }
}

/** The report as plain text for callers that have no snapshot to fall back on. */
export function diffTrees(prev: string, next: string): string | undefined {
  return changeReport(prev, { text: next, refs: [] })?.text
}

const ATTR_FLIP_LINE = /^[+-] (?:html|body)\b/m
const COLOR_CHANGE_LINE = /^[+-] viewport (?:bg|fg)=/m

/**
 * Append the theme-toggle hint: an `html`/`body` attribute or class flipped, yet the
 * body's computed colors did NOT change. That is the exact signature of a theme
 * toggle whose CSS never applied — the stylesheet failed to load, or its selectors
 * don't target the flipped attribute — which reads to the model as "the button
 * focuses but nothing happens". Naming it makes the page-side breakage actionable.
 */
export function annotateDiff(diff: string): string {
  if (ATTR_FLIP_LINE.test(diff) && !COLOR_CHANGE_LINE.test(diff)) {
    return `${diff}\n(attribute changed but computed colors did not — check the stylesheet loaded and its selectors target this attribute)`
  }
  return diff
}
