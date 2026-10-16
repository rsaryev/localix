/**
 * The focus stack: one array, nested owners are offered keys from the top outward.
 *
 * Push is idempotent by id — re-focusing a surface already on the stack moves it to the top rather
 * than adding a second copy. Pane claims are filtered by the event's DOM path; modal barriers stop
 * fallback and constrain global policy even when a field registers above them. Unwinding restores
 * each owner without anyone tracking what was underneath.
 */
import { create } from 'zustand'

import { type FocusEntry, type GlobalKeyPolicy, UNFOCUSED_KEY_POLICY } from './types'

/** The top of the stack. Written out because this package targets ES2020, which has no `Array.at`. */
function last(entries: readonly FocusEntry[]): FocusEntry | null {
  return entries.length === 0 ? null : (entries[entries.length - 1] ?? null)
}

interface FocusStackState {
  entries: FocusEntry[]
  /** Claim focus, or move an existing claim to the top. */
  push: (entry: FocusEntry) => void
  /** Release a claim. Safe to call for an id that is not on the stack. */
  release: (id: string) => void
  /** Test-only: drop every claim. */
  reset: () => void
}

export const useFocusStack = create<FocusStackState>((set) => ({
  entries: [],
  push: (entry) =>
    set((state) => {
      const without = state.entries.filter((existing) => existing.id !== entry.id)
      const top = last(state.entries)
      // Re-pushing the identical entry that is already on top is what a re-render looks like.
      if (
        top?.id === entry.id &&
        top.kind === entry.kind &&
        samePolicy(top.keyboard, entry.keyboard) &&
        top.onKeyDown === entry.onKeyDown &&
        top.scope === entry.scope
      )
        return state
      return { entries: [...without, entry] }
    }),
  release: (id) =>
    set((state) => {
      const entries = state.entries.filter((existing) => existing.id !== id)
      return entries.length === state.entries.length ? state : { entries }
    }),
  reset: () => set({ entries: [] }),
}))

function samePolicy(a: GlobalKeyPolicy, b: GlobalKeyPolicy): boolean {
  return a.plainKeys === b.plainKeys && a.modifierKeys === b.modifierKeys
}

/** The entry that currently owns the keyboard, or `null` when nothing has claimed it. */
export function currentFocusEntry(): FocusEntry | null {
  return last(useFocusStack.getState().entries)
}

/** What the focused surface tolerates, or the unfocused default. */
export function currentKeyPolicy(event?: KeyboardEvent): GlobalKeyPolicy {
  const entries = useFocusStack.getState().entries
  // A field or pane re-registering above a modal cannot reopen global shortcuts behind it.
  let policy = UNFOCUSED_KEY_POLICY
  for (const entry of entries) {
    if (event && !ownsEvent(entry, event) && !isBarrier(entry)) continue
    policy = {
      plainKeys: policy.plainKeys && entry.keyboard.plainKeys,
      modifierKeys: policy.modifierKeys && entry.keyboard.modifierKeys,
    }
  }
  return policy
}

function ownsEvent(entry: FocusEntry, event: KeyboardEvent): boolean {
  if (!entry.scope) return true
  const root = entry.scope()
  if (!root) return false
  return event.composedPath().some((target) => target === root)
}

/**
 * Offer a key to the focused surfaces, innermost first. True when one claimed the event.
 *
 * The walk is what makes NESTING work. A stepped question view lives inside an interaction frame,
 * and both want keys: the view owns the digits, the frame owns Enter and Escape. Offering only to
 * the top entry would mean whichever mounted last silently swallowed the other's keys.
 *
 * The walk stops at the first BARRIER — an overlay-like surface whose policy says no global keys
 * pass. That is the isolation half: a modal on top stops the search dead, so a frame rendered
 * behind it can never resolve a request the user cannot see, and nobody has to go looking for an
 * open dialog to find that out.
 */
export function offerKeyToFocusedSurface(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return true
  if (event.getModifierState('AltGraph')) return true
  const { entries } = useFocusStack.getState()
  let barrierIndex = -1
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry && isBarrier(entry)) {
      barrierIndex = index
      break
    }
  }
  const path = event.composedPath()
  const candidates = entries
    .slice(barrierIndex + 1)
    .map((entry, index) => {
      const root = entry.scope?.()
      return { entry, index, depth: root ? path.indexOf(root) : Infinity }
    })
    .filter(({ entry }) => ownsEvent(entry, event))
    // React mounts child effects before parents. DOM depth determines nested ownership;
    // equal scopes still prefer the latest registration.
    .sort((a, b) => a.depth - b.depth || b.index - a.index)
  const barrier = entries[barrierIndex]
  if (barrier && ownsEvent(barrier, event))
    candidates.push({ entry: barrier, index: -1, depth: Infinity })
  for (const { entry } of candidates) {
    const claimed = entry.onKeyDown?.(event)
    if (claimed === true || event.defaultPrevented) return true
  }
  return false
}

/** An overlay-like surface stops the offer walk even when it handles nothing itself. */
function isBarrier(entry: FocusEntry): boolean {
  return entry.kind === 'dialog' || entry.kind === 'menu' || entry.kind === 'overlay'
}

/** True when an overlay-like surface owns the keyboard. */
export function overlayOwnsKeyboard(): boolean {
  const kind = currentFocusEntry()?.kind
  return kind === 'dialog' || kind === 'menu' || kind === 'overlay'
}

/**
 * True while ANY overlay-like surface is on the stack, not only the top one.
 *
 * `overlayOwnsKeyboard` answers who types next; this answers whether an overlay is on screen at
 * all. The two differ exactly when a field inside a dialog is focused: the input tops the stack,
 * and the dialog still covers the window. A surface the app cannot paint over — the desktop
 * browser page, a native view stacked above the app's own — has to yield for the second question.
 */
export function overlayOnScreen(entries: readonly FocusEntry[]): boolean {
  return entries.some(isBarrier)
}
