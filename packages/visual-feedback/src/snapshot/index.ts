/**
 * Page snapshot — an accessibility-flavored, indented TEXT tree of the live page,
 * the primary channel the agent reads (a few hundred tokens vs raw HTML/pixels).
 *
 * Every emitted node gets a fresh stable `eN` ref stored in a per-mount registry,
 * so the agent can then `click @e3` / `screenshot @e7`. Interactive nodes also
 * capture a durable CSS selector so the registry can SELF-HEAL a ref across a
 * re-render (see ref-registry.ts) — a click on a "stale" ref re-resolves and still
 * lands instead of dead-looping. Vanilla DOM, shadow-aware, zero external deps;
 * reuses the role/name + selector heuristics from `core/identify`.
 */

import { VF_IGNORE_ATTR } from '../protocol/index'
import type { VfElement, VfSnapshot } from '../protocol/index'
import { generateSelector } from '../core/identify'
import {
  SKIP_TAGS,
  viewOf,
  isHidden,
  holdsChoices,
  isInteractive,
  roleLabel,
  stateSuffix,
  shouldEmit,
} from './classify'
import { fieldValue, isEditable, isField } from './field'

// The per-mount `eN` ref registry lives in its own leaf; re-exported here so the
// snapshot module's public surface is unchanged.
export { createRefRegistry } from './ref-registry'
export type { RefRegistry, RefIdentity } from './ref-registry'
import type { RefRegistry } from './ref-registry'

interface WalkCtx {
  reg: RefRegistry
  lines: string[]
  interactiveOnly: boolean
  maxDepth: number
  /** Hard cap on emitted nodes — bounds the snapshot's token cost on huge pages. */
  maxNodes: number
  nodes: number
  interactive: number
  truncated: boolean
  /** Every interactive node, structured; {@link pickElements} keeps {@link MAX_ELEMENTS}. */
  elements: VfElement[]
  /** Whether each of `elements` is on screen now. */
  inView: boolean[]
}

/** Structured interactive nodes kept per snapshot; the tree keeps its own node cap. */
const MAX_ELEMENTS = 250

/** An open dialog: what a person acts in while it is up — a date picker, a menu sheet, a modal. */
const DIALOG = '[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]'

/** Whether any part of `el` is inside the viewport. */
function inViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  const view = el.ownerDocument?.defaultView
  if (!view) return true
  return (
    rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth
  )
}

/** Roles that come by the hundred — a calendar's days, a long list's rows — and crowd out the rest. */
const REPEATED_ROLES = new Set(['gridcell', 'option', 'row', 'treeitem', 'listitem', 'menuitem'])

/**
 * At most {@link MAX_ELEMENTS}, kept in tree order. Chosen by tier: on-screen controls, then
 * off-screen ones that are not one of many (a button, a field, a link), then the repeated rest. A
 * page with more controls than that used to lose its LAST ones — a date picker's Done button
 * after 300 calendar days (Google Flights, 2026-10-20) — so a caller choosing among them could
 * only scroll.
 */
function pickElements(elements: VfElement[], inView: boolean[]): VfElement[] {
  if (elements.length <= MAX_ELEMENTS) return elements
  const tier = (element: VfElement, i: number) =>
    inView[i] ? 0 : REPEATED_ROLES.has(element.role) ? 2 : 1
  const ranked = elements
    .map((element, i) => ({ element, i, tier: tier(element, i) }))
    .sort((a, b) => a.tier - b.tier || a.i - b.i)
  const keep = new Set(ranked.slice(0, MAX_ELEMENTS).map((entry) => entry.element))
  return elements.filter((element) => keep.has(element))
}

function walk(el: Element, depth: number, ctx: WalkCtx): void {
  if (ctx.truncated) return // node cap already hit — stop traversing (output unchanged)
  const tag = el.tagName.toLowerCase()
  if (SKIP_TAGS.has(tag)) return
  if (el.hasAttribute(VF_IGNORE_ATTR)) return // the probe's own overlay
  const cs = viewOf(el)?.getComputedStyle(el) ?? null
  if (isHidden(el, cs)) return

  const interactive = isInteractive(el, cs)
  const { emit, name } = shouldEmit(el, interactive)
  let childDepth = depth

  if (emit && (!ctx.interactiveOnly || interactive)) {
    // Stop emitting (and descending) once the node cap is hit — a pathologically large
    // page would otherwise dump tens of thousands of tokens into the agent's context.
    if (ctx.nodes >= ctx.maxNodes) {
      ctx.truncated = true
      return
    }
    ctx.nodes++
    if (interactive) ctx.interactive++
    const role = roleLabel(el)
    // Capture a durable structural identity for INTERACTIVE nodes only (the ones
    // that get clicked/typed): a CSS selector plus role+name, so the registry can
    // re-resolve them after a re-render — by selector first, then structurally when
    // the selector itself went stale (dynamic classes / shifted position). Bounds
    // the cost of generateSelector's uniqueness checks to a handful of nodes.
    const ref = ctx.reg.put(
      el,
      interactive ? { selector: generateSelector(el).selector, role, name } : undefined,
    )
    const label = name ? `${role} "${name}"` : role
    // A field's value is shown apart from its label, so an empty field reads as empty.
    const value = isField(el) ? fieldValue(el) : ''
    const states = stateSuffix(el)
    ctx.lines.push(
      `${'  '.repeat(Math.min(depth, ctx.maxDepth))}- ${label}${value ? ` = "${value}"` : ''}${states} [ref=${ref}]`,
    )
    if (interactive) {
      const stateList = states ? states.slice(2, -1).split(', ') : []
      ctx.inView.push(inViewport(el))
      ctx.elements.push({
        ref,
        role,
        name,
        ...(value ? { value } : {}),
        ...(stateList.length ? { states: stateList } : {}),
        ...(isEditable(el) ? { editable: true } : {}),
        ...(el.closest(DIALOG) ? { dialog: true } : {}),
      })
    }
    childDepth = depth + 1
    // An interactive control is a leaf: its inner text IS its accessible name, so
    // descending would re-emit that text as duplicate child "text" nodes.
    // A listbox, menu or grid is the exception: its children are the choices to act on.
    if (interactive && !holdsChoices(el)) return
  }

  if (depth >= ctx.maxDepth) return
  // Recurse, piercing an open shadow root when present.
  const root = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot
  const children = root ? root.children : el.children
  for (const child of Array.from(children)) walk(child, childDepth, ctx)
}

export interface SnapshotOptions {
  interactiveOnly?: boolean
  maxDepth?: number
  /** Max emitted nodes (default 800) — a safety bound on snapshot token cost. */
  maxNodes?: number
  /** Walk this subtree instead of the page body (see `ActuateDeps.root`). */
  root?: Element
}

/** Default emitted-node cap — generous for real pages, bounds pathological ones. */
const DEFAULT_MAX_NODES = 800

/**
 * Build a snapshot of the current page and (re)populate `reg` with `eN` refs.
 * Clears `reg` first, so any previously handed-out refs are invalidated.
 */
export function buildSnapshot(reg: RefRegistry, opts: SnapshotOptions = {}): VfSnapshot {
  reg.clear()
  const ctx: WalkCtx = {
    reg,
    lines: [],
    interactiveOnly: !!opts.interactiveOnly,
    maxDepth: Math.max(1, Math.min(opts.maxDepth ?? 20, 40)),
    maxNodes: Math.max(1, opts.maxNodes ?? DEFAULT_MAX_NODES),
    nodes: 0,
    interactive: 0,
    truncated: false,
    elements: [],
    inView: [],
  }
  const start = opts.root ?? document.body ?? document.documentElement
  if (start) for (const child of Array.from(start.children)) walk(child, 0, ctx)
  if (ctx.truncated) {
    ctx.lines.push(
      `… (snapshot truncated at ${ctx.maxNodes} nodes — narrow with a CSS selector, interactiveOnly:true, or a smaller maxDepth)`,
    )
  }

  const tree = ctx.lines.length ? ctx.lines.join('\n') : '(no visible elements)'
  return {
    tree,
    stats: { nodes: ctx.nodes, interactive: ctx.interactive, chars: tree.length },
    url: location.href,
    title: opts.root?.getAttribute('aria-label') ?? document.title,
    ...(ctx.elements.length ? { elements: pickElements(ctx.elements, ctx.inView) } : {}),
  }
}
