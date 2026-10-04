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
 * Folding document state into the baseline makes such changes visible.
 */

import { buildSnapshot, type RefRegistry } from '../snapshot/index'

/** No-op registry for the throwaway snapshot we build only to diff (keeps live refs valid). */
function nullRegistry(): RefRegistry {
  return {
    clear() {},
    put: () => 'e0',
    get: () => null,
    identityOf: () => null,
    findByIdentity: () => null,
  }
}

/** Internal: the interactive-only tree half of `documentChangeSignature` below. */
function interactiveLines(root?: Element): string {
  return buildSnapshot(nullRegistry(), { interactiveOnly: true, maxDepth: 30, root }).tree
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

/** The combined structural + document-state signature used as the diff baseline. */
export function stateForDiff(root?: Element): string {
  return `${documentStateSignature(root)}\n${interactiveLines(root)}`
}

export function diffTrees(prev: string, next: string): string | undefined {
  if (!prev) return undefined
  const a = new Set(prev.split('\n').map((l) => l.trim()))
  const b = new Set(next.split('\n').map((l) => l.trim()))
  const added = [...b].flatMap((l) => (l && !a.has(l) ? [`+ ${l.replace(/^- /, '')}`] : []))
  const removed = [...a].flatMap((l) => (l && !b.has(l) ? [`- ${l.replace(/^- /, '')}`] : []))
  const out = [...removed, ...added]
  if (!out.length) return '(no visible change)'
  return annotateDiff(out.slice(0, 30).join('\n'))
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
