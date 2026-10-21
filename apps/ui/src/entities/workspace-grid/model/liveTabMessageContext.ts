import {
  normalizePublishedMessageContext,
  PUBLISHED_MESSAGE_CONTEXT_MAX_BINDINGS,
  type MessageContextBindingDraft,
  type PublishedMessageContext,
} from '@localixai/plugin-sdk/ui'

/**
 * Central, framework-neutral registry for live context published by mounted tab bodies.
 *
 * The registry deliberately knows neither plugin names nor URI namespaces. A plugin publishes
 * canonical binding drafts; the grid combines them with the tab's static contribution and the
 * composer later turns the same drafts into refs. Keeping this outside React state also lets a
 * chart/log viewer publish at its own cadence without rewriting the persisted WorkItem payload.
 */
const publications = new Map<string, PublishedMessageContext>()
const listeners = new Set<() => void>()
let revision = 0

function sameBindings(
  a: readonly MessageContextBindingDraft[],
  b: readonly MessageContextBindingDraft[],
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (bindingSignature(a[i]!) !== bindingSignature(b[i]!)) return false
  }
  return true
}

function bindingSignature(binding: MessageContextBindingDraft): string {
  return JSON.stringify({
    ...binding,
    target: {
      ...binding.target,
      attributes: binding.target.attributes
        ? Object.fromEntries(
            Object.entries(binding.target.attributes).sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          )
        : undefined,
    },
  })
}

function cloneBinding<T extends MessageContextBindingDraft>(binding: T): T {
  return {
    ...binding,
    target: {
      ...binding.target,
      ...(binding.target.attributes ? { attributes: { ...binding.target.attributes } } : {}),
    },
  } as T
}

function notify(): void {
  revision += 1
  for (const listener of listeners) listener()
}

/** Publish or remove the live facets for one mounted tab. Equal publications are idempotent. */
export function publishLiveTabMessageContext(
  tabId: string,
  context: PublishedMessageContext | null,
): void {
  const current = publications.get(tabId)
  // Every producer crosses the same runtime boundary, and the value is validated BEFORE anything
  // reads it. Reading `context.bindings` first let one plugin that published
  // `{ strategy: 'replace', text }` crash its whole tab ("undefined is not an object (evaluating
  // 'context.bindings.length')") — types are erased at runtime, and a plugin built
  // by the app is not type-checked. Malformed input clears the tab's context, loudly, and never
  // throws into the render.
  const removal = context === null || (Array.isArray(context.bindings) && !context.bindings.length)
  const normalized = removal ? null : normalizePublishedMessageContext(context)
  if (!removal && !normalized) {
    console.warn(
      '[plugin-ui] ignored an invalid live message context: publish { strategy, bindings } built with the SDK binding drafts',
      context,
    )
  }
  if (!normalized) {
    if (!current) return
    publications.delete(tabId)
    notify()
    return
  }
  const next: PublishedMessageContext = {
    strategy: normalized.strategy,
    // The host owns the stored value: do not retain mutable plugin objects, and
    // enforce the same facet ceiling used at the sandbox boundary.
    bindings: normalized.bindings
      .slice(0, PUBLISHED_MESSAGE_CONTEXT_MAX_BINDINGS)
      .map(cloneBinding),
  }
  if (current?.strategy === next.strategy && sameBindings(current.bindings, next.bindings)) {
    return
  }
  publications.set(tabId, next)
  notify()
}

/** Current live publication for a tab; used only by the central tab→binding adapter. */
export function liveTabMessageContext(tabId: string): PublishedMessageContext | undefined {
  return publications.get(tabId)
}

/** External-store seam used by `useActiveTabRefs` so a view switch updates the chips immediately. */
export function subscribeLiveTabMessageContext(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function liveTabMessageContextRevision(): number {
  return revision
}

/** Test seam: publications are process-local UI state and must never leak between cases. */
export function clearLiveTabMessageContext(): void {
  if (publications.size === 0) return
  publications.clear()
  notify()
}
