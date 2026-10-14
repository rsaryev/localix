import { createBoundedCache } from '@localixai/kit/lib'
import type { DesktopNotifyKind } from '@/shared/lib/desktopNotify'
import type { NotificationAction, NotificationEntry } from './types'

/**
 * WHAT THIS WINDOW KNOWS ABOUT A ROW THAT THE JOURNAL CANNOT HOLD.
 *
 * A toast's "Undo", a problem's "Open board.json:7", a recovery's "Retry connection" are closures
 * over this process's state. They cannot cross the wire and they would be wrong after a reload, so
 * the server row carries only the serializable actions and this map carries the rest, keyed by the
 * row's journal key and merged in when the Event Center renders (`journal.ts`). A reload drops the
 * map, which is the point: the durable record survives, the stale closure does not.
 *
 * Beside it, the hints: how a producer wanted its fact DELIVERED — whether it is worth an OS
 * banner — because that is a decision about this moment, not part of the record.
 */

export interface DeliveryHint {
  /** The native banner kind, or null when this fact never interrupts (an outage, a diagnostic). */
  nativeKind: DesktopNotifyKind | null
}

interface Overlay {
  /** The producer's action list, in its order; serializable members are refreshed from the row. */
  actions: NotificationAction[]
}

const overlays = new Map<string, Overlay>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
/**
 * Consumed by the first live change that opens the row. Bounded, because a raise that folds into
 * another row (a coalesced repeat) or replays an open one never opens anything to consume it.
 */
const hints = createBoundedCache<string, DeliveryHint>({ maxEntries: 200 })
let onExpire: (() => void) | null = null

const isCallback = (action: NotificationAction) => action.kind === 'callback' || !!action.onClick

function clearTimer(key: string): void {
  const timer = timers.get(key)
  if (timer) clearTimeout(timer)
  timers.delete(key)
}

/** Called when an overlay's callbacks expire, so the rendered rows drop them (`journal.ts`). */
export function onOverlayExpired(listener: () => void): void {
  onExpire = listener
}

/** Keep a row's callbacks for as long as they mean something. */
export function setOverlay(key: string, actions: NotificationAction[]): void {
  clearTimer(key)
  const callbacks = actions.filter(isCallback)
  if (callbacks.length === 0) {
    overlays.delete(key)
    return
  }
  overlays.set(key, { actions })
  // A callback that stops meaning anything at a known time leaves the map then, rather than
  // lingering until the row is settled or removed.
  const expiries = callbacks.map((action) => action.expiresAt)
  if (expiries.every((at): at is number => at != null)) {
    const delay = Math.max(0, Math.max(...expiries) - Date.now())
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key)
        if (!overlays.delete(key)) return
        onExpire?.()
      }, delay),
    )
  }
}

export function setDeliveryHint(key: string, hint: DeliveryHint): void {
  hints.set(key, hint)
}

/** The producer's wish for this row's delivery, once: the decision is made on the first change. */
export function takeDeliveryHint(key: string): DeliveryHint | undefined {
  const hint = hints.peek(key)
  hints.delete(key)
  return hint
}

/** The row settled or left the journal: its callbacks can never act again. */
export function dropOverlay(key: string): void {
  clearTimer(key)
  overlays.delete(key)
}

/**
 * The row as rendered: the producer's callbacks in the producer's order, each serializable action
 * taken from the SERVER row (which knows whether it is still available), and any action only the
 * server knows appended.
 */
export function withOverlay(entry: NotificationEntry): NotificationEntry {
  const overlay = overlays.get(entry.id)
  if (!overlay || !overlay.actions.some(isCallback)) return entry
  const stored = new Map((entry.actions ?? []).map((action) => [action.id, action]))
  const merged: NotificationAction[] = []
  for (const action of overlay.actions) {
    if (isCallback(action)) {
      merged.push(entry.resolvedAt != null ? { ...action, available: false } : action)
    } else {
      const current = stored.get(action.id)
      if (current) merged.push(current)
    }
    stored.delete(action.id)
  }
  merged.push(...stored.values())
  return { ...entry, actions: merged }
}

export function resetOverlaysForTests(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  overlays.clear()
  hints.clear()
}
