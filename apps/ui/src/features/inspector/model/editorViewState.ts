/**
 * Per-file EDITOR VIEW STATE memory — the cursor position + scroll offset for
 * each open file, so returning to a file (after a scope switch, a tab reopen, or
 * a full reload) restores the exact spot the user left off.
 *
 * A file tab's live EditorView already survives a scope switch (the grid keeps
 * background tabs warm-mounted), so the in-memory case needs no help. This memory
 * covers the DURABLE case: it's a lightweight `{line, column, top}` descriptor —
 * never an editor snapshot — persisted to localStorage and capped with LRU
 * eviction so it stays small no matter how many files get opened over time.
 *
 * Keyed per SESSION + path (mirroring how the grid keys file tabs), so the same
 * path open in two sessions restores independently. The reducers are pure (store
 * in → store out) and unit tested; the thin wrappers own storage.
 */

import { loadJSON, saveJSON } from '@localixai/plugin-sdk/ui/storage'

const STORAGE_KEY = 'localix_editor_view_state'
/** Cap on remembered files — LRU beyond this so storage never grows unbounded. */
export const MAX_VIEW_STATES = 300

/** A file's remembered caret + scroll. `line`/`top` are 1-based; `column` 0-based. */
export interface EditorViewSnapshot {
  /** 1-based caret line. */
  line: number
  /** 0-based caret column within `line`. */
  column: number
  /** 1-based first visible (top) line — drives scroll restore. */
  top: number
}

/** The view-state store: snapshots keyed by {@link editorViewKey} + an MRU order
 *  (most-recent first) used for LRU eviction. */
export interface ViewStateStore {
  states: Record<string, EditorViewSnapshot>
  /** Keys most-recently-touched first. */
  order: string[]
}

const EMPTY_STORE: ViewStateStore = { states: {}, order: [] }

/** The storage key for a file's view state. `sessionId` scopes it per session. */
export function editorViewKey(sessionId: string | null | undefined, path: string): string {
  return `${sessionId ?? '_'}::${path}`
}

function isSnapshot(v: unknown): v is EditorViewSnapshot {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  return typeof s.line === 'number' && typeof s.column === 'number' && typeof s.top === 'number'
}

/**
 * Put a file's snapshot into the store: overwrite its state, move it to the front
 * of the MRU order, and evict the least-recently-used beyond {@link MAX_VIEW_STATES}.
 * Pure — returns a new store (callers persist the result).
 */
export function putViewState(
  store: ViewStateStore,
  key: string,
  snapshot: EditorViewSnapshot,
): ViewStateStore {
  const order = [key, ...store.order.filter((k) => k !== key)]
  const states = { ...store.states, [key]: snapshot }
  // Evict LRU tail beyond the cap.
  while (order.length > MAX_VIEW_STATES) {
    const evicted = order.pop()
    if (evicted) delete states[evicted]
  }
  return { states, order }
}

/** Read a file's snapshot, or `null` when none is remembered. */
export function getViewState(store: ViewStateStore, key: string): EditorViewSnapshot | null {
  return store.states[key] ?? null
}

/** Read the persisted view-state store. Tolerates corrupt/partial storage. */
export function loadViewStateStore(): ViewStateStore {
  const raw = loadJSON<unknown>(STORAGE_KEY)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_STORE
  const r = raw as Record<string, unknown>
  const states: Record<string, EditorViewSnapshot> = {}
  if (r.states && typeof r.states === 'object' && !Array.isArray(r.states)) {
    for (const [key, value] of Object.entries(r.states as Record<string, unknown>)) {
      if (isSnapshot(value)) states[key] = value
    }
  }
  const order = Array.isArray(r.order)
    ? (r.order as unknown[]).filter((k): k is string => typeof k === 'string' && k in states)
    : Object.keys(states)
  return { states, order }
}

function saveViewStateStore(store: ViewStateStore): void {
  saveJSON(STORAGE_KEY, store)
}

// ── Persistence-backed convenience wrappers ───────────────────────────────────

/** The remembered snapshot for a file key, read straight from storage. */
export function loadEditorViewState(key: string): EditorViewSnapshot | null {
  return getViewState(loadViewStateStore(), key)
}

/** Remember a file's snapshot (load → put → save). Best-effort. */
export function saveEditorViewState(key: string, snapshot: EditorViewSnapshot): void {
  saveViewStateStore(putViewState(loadViewStateStore(), key, snapshot))
}
