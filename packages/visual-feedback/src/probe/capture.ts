/**
 * Turn a picked (or hovered) DOM element into the structured {@link VfCapture} the
 * host receives — selector, readable path, role, text, component ancestry, opening
 * tag, computed style, rect, and best-effort source. Pure description logic, kept out
 * of the probe entry glue so it's cohesive and reusable.
 */

import type { VfCapture, VfSource } from '../protocol/index'
import {
  generateSelector,
  getReadablePath,
  getSemanticRole,
  getElementSummary,
  getNearbyText,
  getComputedStyleSnapshot,
  getOpenTagHtml,
} from '../core/identify'
import { getCleanedClasses } from '../core/css-classes'
import { getViewportRect } from '../core/geometry'
import { clampCapture } from '../core/redact'
import { reactComponentPath } from '../source/index'
import type { PickEvent } from '../selection/fsm'

/** Full capture for a pick. Returns null when there's nothing to describe. */
export function buildCapture(
  ev: PickEvent,
  resolveSource: (el: Element) => VfSource | null,
): VfCapture | null {
  if (ev.kind === 'area' && ev.rect) {
    // A whole-window sweep says what it is and anchors to the document, so its screenshot is
    // the page and the agent is told the comment is about the screen, not a rectangle in it.
    return {
      selector: ev.page ? 'body' : '',
      summary: ev.page ? 'the whole page' : 'region',
      domPath: ev.page ? 'body' : '',
      classes: '',
      rect: ev.rect,
      kind: 'area',
    }
  }
  const el = ev.element
  if (!el) return null
  // Redact secrets + strip URL query/hash before the capture leaves the page —
  // an href token or aria-label PII must not cross into the agent's context.
  return clampCapture({
    selector: generateSelector(el).selector,
    summary: getElementSummary(el),
    domPath: getReadablePath(el),
    classes: getCleanedClasses(el),
    role: getSemanticRole(el),
    text: ev.kind === 'text' ? ev.text : getNearbyText(el),
    componentPath: reactComponentPath(el),
    html: getOpenTagHtml(el),
    computedStyle: getComputedStyleSnapshot(el),
    rect: getViewportRect(el),
    source: resolveSource(el) ?? undefined,
    kind: ev.kind,
    members: ev.members?.map((m) => generateSelector(m).selector),
  })
}
