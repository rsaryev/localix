// Global spend-alert budget for the current chat session. A single USD threshold
// shared across the app: once a session's cumulative *metered* spend crosses a
// multiple of it, a dismissible strip warns above the composer. Persisted to
// localStorage so it survives reloads; 0 (or unset) means the alert is off.
//
// Pure browser-only preference module (no `features`/`shared/api`/store import) —
// lives in the lowest FSD layer beside storage.ts, mirroring the editor's own
// client-persisted prefs (wordWrap, renderWhitespace).
// The per-session dismissal state is ephemeral (in-memory, resets on reload) —
// it only suppresses re-nagging within a session, not a durable setting.

import { useSyncExternalStore } from 'react'
import { createBoundedCache } from '@localixai/kit/lib'
import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'

const STORAGE_KEY = 'localix.chat.spendAlertUsd'

let threshold = readInitial()
const listeners = new Set<() => void>()

function readInitial(): number {
  const raw = loadString(STORAGE_KEY)
  if (raw === null) return 0
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Current spend-alert threshold in USD; 0 means the alert is disabled. */
export function getSpendThreshold(): number {
  return threshold
}

/** Set the threshold, persist it, and notify subscribers. Values ≤ 0 disable it. */
export function setSpendThreshold(usd: number): void {
  const next = Number.isFinite(usd) && usd > 0 ? usd : 0
  if (next === threshold) return
  threshold = next
  saveString(STORAGE_KEY, next > 0 ? String(next) : null)
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Reactively read the threshold (re-renders on change). */
export function useSpendThreshold(): number {
  return useSyncExternalStore(subscribe, getSpendThreshold, getSpendThreshold)
}

/**
 * The escalation level of a session's spend: how many whole multiples of the
 * threshold it has crossed. 0 = under budget (or alert off). Used both to decide
 * whether to show the strip and to re-alert when spend climbs into a new bracket.
 */
export function spendLevel(costUsd: number | undefined, budget: number): number {
  if (budget <= 0 || costUsd === undefined || costUsd <= 0) return 0
  return Math.floor(costUsd / budget)
}

// Ephemeral per-session dismissal: the highest level the user has dismissed.
// Crossing into a *higher* level re-shows the strip; a reload clears it.
// Bounded so a long-lived tab that visits many sessions can't accumulate a dismissal
// entry for every session ever dismissed. Only bites past this many dismissed sessions
// in one tab lifetime; evicting the least recently dismissed just means its (already
// reload-ephemeral) suppression is forgotten, so its strip could re-show if that
// ancient session is still open and re-crosses the threshold — acceptable. A render's
// visibility check `peek`s, so only a dismissal counts as a use.
const dismissedLevel = createBoundedCache<string, number>({ maxEntries: 500 })
const dismissalListeners = new Set<() => void>()

/** True when the strip at `level` is above the one dismissed ({@link useDismissedSpendLevel}). */
export function isSpendAlertVisible(level: number, dismissed: number): boolean {
  return level >= 1 && dismissed < level
}

/** Suppress the strip for this session until spend crosses a higher multiple. */
export function dismissSpendAlert(sessionId: string, level: number): void {
  dismissedLevel.set(sessionId, level)
  for (const fn of dismissalListeners) fn()
}

function subscribeDismissals(fn: () => void): () => void {
  dismissalListeners.add(fn)
  return () => dismissalListeners.delete(fn)
}

/**
 * The level dismissed for this session, 0 for none, read again on a dismissal. A value rather than
 * a re-render beside a lookup: the built app's React Compiler keeps a render's call to a module
 * function on its arguments, so a dismissed strip stayed on screen.
 */
export function useDismissedSpendLevel(sessionId: string | null): number {
  const read = () => (sessionId ? dismissedSpendLevel(sessionId) : 0)
  return useSyncExternalStore(subscribeDismissals, read, read)
}

/** The level dismissed for this session, 0 for none, outside a render. */
export function dismissedSpendLevel(sessionId: string): number {
  return dismissedLevel.peek(sessionId) ?? 0
}
