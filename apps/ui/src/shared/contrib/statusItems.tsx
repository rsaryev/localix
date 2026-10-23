import { Component, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import type { StatusItemContribution, StatusItemState } from '@localixai/mini-app-sdk/ui'

import { isPluginContributionEnabled, subscribePluginActivation } from './pluginActivation'
import {
  isStatusItemPresent,
  reportStatusItemPresence,
  useStatusItemPresence,
} from './statusItemPresence'
import { StatusItemControl } from '@/shared/ui/status-item'

const contributions = new Map<string, StatusItemContribution>()
const listeners = new Set<() => void>()
let version = 0

/**
 * Tell every mounted strip that {@link statusItemsFor} would now answer differently.
 *
 * A bar showing contributed items is a pure function of two module stores — this registry and the
 * activation gate — and neither is React state, so without an explicit signal a strip renders the
 * answer it got at MOUNT and keeps it. That is not a theoretical gap: plugin UI chunks are
 * imported after the capability snapshot resolves, which is well after the titlebar first paints,
 * so every contributed glyph registers into a bar that has already decided it has none. Whether
 * they ever appeared came down to whether something unrelated happened to re-render the row.
 */
function announceStatusItems(): void {
  version += 1
  for (const listener of listeners) listener()
}

// Enabling or disabling a plugin changes what the gate lets through without touching the registry,
// so the activation store is the second source this signal has to carry.
subscribePluginActivation(announceStatusItems)

export function registerStatusItem(contribution: StatusItemContribution): void {
  const existing = contributions.get(contribution.id)
  if (existing === contribution) return
  if (existing) {
    console.warn(
      `[ui-contrib] duplicate status item "${contribution.id}" — keeping the first owner`,
    )
    return
  }
  contributions.set(contribution.id, contribution)
  announceStatusItems()
}

/** Drop every item `owner` registered (a plugin reload or unload) and tell the bars. */
export function removeStatusItemsOf(owner: string): void {
  let removed = false
  for (const [id, item] of contributions) {
    if (item.pluginName !== owner) continue
    contributions.delete(id)
    removed = true
  }
  if (removed) announceStatusItems()
}

function subscribeStatusItems(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function statusItemsVersion(): number {
  return version
}

/**
 * The re-read signal every host bar needs: a registration, or a change to which plugins are on.
 *
 * It replaces `usePluginContribVersion()`, which was the wrong store for this. That counter
 * advances only when the capability SET moves, so a relaunch that restores the previous session's
 * plugins — same revision, same names — published its snapshot without ever bumping it, and the
 * titlebar stayed empty for the whole session.
 */
export function useStatusItemsVersion(): number {
  return useSyncExternalStore(subscribeStatusItems, statusItemsVersion, statusItemsVersion)
}

/**
 * Every enabled item for one placement, in a STABLE order.
 *
 * Sorted by `(pluginName, id)` rather than by anything the plugin declares. A numeric `order`
 * would be a position each author asserts about itself, and the equilibrium of that game is
 * everyone claiming the leftmost slot — a fight the user loses. Sorting on identity is not
 * winnable, does not depend on which plugin loaded first, and keeps one plugin's items adjacent
 * to each other, with their relative order its own business.
 */
export function statusItemsFor(placement: string): StatusItemContribution[] {
  return [...contributions.values()]
    .filter((item) => item.placement === placement && isPluginContributionEnabled(item.pluginName))
    .sort(
      (a, b) => (a.pluginName ?? '').localeCompare(b.pluginName ?? '') || a.id.localeCompare(b.id),
    )
}

/**
 * Every item for one placement that is currently drawing, in {@link statusItemsFor}'s order.
 *
 * The order is the registry's, never presence's: an item going quiet and coming back must land
 * where it was, not at the end. That is the whole reason this filters a sorted list rather than
 * keeping its own.
 */
export function liveStatusItemsFor(placement: string): StatusItemContribution[] {
  return statusItemsFor(placement).filter((item) => isStatusItemPresent(item.id))
}

/**
 * One contribution's live state, isolated.
 *
 * Its own component because `useItem` is a HOOK: rendering several inside one component would
 * make every plugin share one hook order, and an item appearing or disappearing would corrupt
 * its neighbours' state. Keyed by id, so a plugin toggling off unmounts cleanly.
 */
function StatusItemSlot({
  contribution,
  sessionId,
  placement,
  compact,
  visible,
}: {
  contribution: StatusItemContribution
  sessionId: string | null
  placement: string
  compact?: boolean
  /** Draw here, or leave the drawing to the overflow menu — the hook runs either way. */
  visible: boolean
}) {
  const state = contribution.useItem(sessionId)
  const live = Boolean(state)
  // An effect, because this publishes to a store every mounted strip reads: reporting during
  // render would be a write in another component's render pass.
  useEffect(() => {
    reportStatusItemPresence(contribution.id, live)
  }, [contribution.id, live])
  // Unmounting (the plugin was disabled, the bar went away) retracts the claim, so a stale id can
  // never keep a slot warm for an item nobody is rendering.
  useEffect(
    () => () => {
      reportStatusItemPresence(contribution.id, false)
    },
    [contribution.id],
  )
  if (!state || !visible) return null
  return <StatusItemControl state={state} placement={placement} compact={compact} />
}

/**
 * A failed item is one missing item, never a missing workbench.
 *
 * These render in the titlebar and the status bar — the chrome around everything. Without a
 * boundary here a plugin throwing inside `useItem` unwinds to the nearest one above, which is the
 * app shell, and the user sees a blank window rather than a plugin that broke. We have already
 * paid for that lesson twice: an unstable snapshot reached the route boundary, and one throwing
 * completion surface took down an RPC carrying other surfaces' answers.
 */
export class StatusItemBoundary extends Component<
  { itemId: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.warn(`[ui-contrib] status item "${this.props.itemId}" failed to render`, error)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * Render every contributed item for one placement.
 *
 * {@link useStatusItemsVersion} is the re-read signal: a plugin registering an item, or being
 * enabled or disabled, changes what `statusItemsFor` returns, and nothing else would tell React to
 * ask again.
 */
export function StatusItems({
  placement,
  sessionId,
  max,
  compact,
  renderOverflow,
}: {
  placement: string
  sessionId: string | null
  /** Cap on visible items; the rest go to `renderOverflow`. Uncapped when absent. */
  max?: number
  /**
   * Render every visible item icon-only (its live text moves to the tooltip).
   *
   * A property of the STRIP, never of one item: an item that decided this for itself would make
   * its width depend on its neighbours, and the bar would have to re-measure itself to know its
   * own layout. The host bar measures once and tells everyone — see `status-strip-fit.ts`.
   */
  compact?: boolean
  renderOverflow?: (hidden: StatusItemContribution[]) => ReactNode
}) {
  useStatusItemsVersion()
  useStatusItemPresence()
  const items = statusItemsFor(placement)
  // The window is spent on items that are DRAWING. Slicing the declarations instead is what put
  // four glyphs and a dead `…` in a titlebar with ten plugins: six of the ten slots went to items
  // whose `useItem` returns `null` for this session, and the two that overflowed were `null` too.
  const live = items.filter((item) => isStatusItemPresent(item.id))
  const visible = new Set((max === undefined ? live : live.slice(0, max)).map((item) => item.id))
  const hidden = max === undefined ? [] : live.slice(max)

  return (
    <>
      {items.map((contribution) => (
        <StatusItemBoundary key={contribution.id} itemId={contribution.id}>
          <StatusItemSlot
            contribution={contribution}
            sessionId={sessionId}
            placement={placement}
            compact={compact}
            // Its first frame, before it has reported anything: draw. An item whose place is the
            // overflow menu settles there on the next frame, whereas an item held back until it
            // has proven itself would make every strip open empty.
            visible={visible.has(contribution.id) || !isStatusItemPresent(contribution.id)}
          />
        </StatusItemBoundary>
      ))}
      {hidden.length > 0 && renderOverflow?.(hidden)}
    </>
  )
}

/**
 * How many items are registered for a placement — what an ADAPTIVE bar needs to lay itself out
 * before it renders a single one of them.
 *
 * Contributions, not rendered controls: an item may return `null` for the current session, and a
 * strip that sized itself on that would re-shape as the user moves between sessions.
 */
export function useStatusItemCount(placement: string): number {
  useStatusItemsVersion()
  return statusItemsFor(placement).length
}

/**
 * How many items for a placement are currently DRAWING — the number an adaptive strip spends.
 *
 * The sibling above counts declarations, which is the right question for "does this bar need to
 * exist at all" and the wrong one for "how many glyphs am I laying out": most bundled plugins
 * declare a titlebar item and draw nothing until they have something to say. Sizing on
 * declarations reserved room for the silent ones and folded the speaking ones into `…`.
 *
 * It reads what mounted slots have reported, so it is zero for one frame on a cold mount. That is
 * exactly the frame `fitStatusStrip` has no measurement for either, and it renders everything.
 */
export function useLiveStatusItemCount(placement: string): number {
  useStatusItemsVersion()
  useStatusItemPresence()
  return liveStatusItemsFor(placement).length
}

/**
 * Whether anything is registered for a placement, so a host bar that is otherwise empty can still
 * decide to exist. Without it a contributed item would render into a row that was never mounted —
 * indistinguishable, from the plugin author's chair, from a seam that does not work.
 */
export function useHasStatusItems(placement: string): boolean {
  return useStatusItemCount(placement) > 0
}

/** The state of one contribution, for an overflow menu that has to label what it hides. */
export function useStatusItemState(
  contribution: StatusItemContribution,
  sessionId: string | null,
): StatusItemState | null {
  return contribution.useItem(sessionId)
}
