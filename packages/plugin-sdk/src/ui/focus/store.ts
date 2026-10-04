/**
 * The focus stack: one array, last entry wins.
 *
 * Push is idempotent by id — re-focusing a surface already on the stack moves it to the top rather
 * than adding a second copy, so a component that pushes on every render cannot grow the stack. Every
 * question the dispatcher asks is about the LAST entry, which is why nesting works for free: open a
 * dialog over a pane, then a menu inside the dialog, and unwinding restores each owner in turn
 * without anyone tracking what was underneath.
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
        samePolicy(top.keyboard, entry.keyboard)
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
export function currentKeyPolicy(): GlobalKeyPolicy {
  return currentFocusEntry()?.keyboard ?? UNFOCUSED_KEY_POLICY
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
  const { entries } = useFocusStack.getState()
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (!entry) continue
    const claimed = entry.onKeyDown?.(event)
    if (claimed === true || event.defaultPrevented) return true
    if (isBarrier(entry)) return false
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
