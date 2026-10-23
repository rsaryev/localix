import { workspaceStorageKey } from '@/shared/lib/workspaceWindow'
/**
 * Per-scope WORKSPACE LOCATION memory — the "restore the workspace where
 * I left it" state for each project.
 *
 * Switching project scope (`nav.switchProject`) navigates to a bare scope path,
 * which drops the open right-sidebar SECTION (files/jobs/database) and the left
 * sidebar's open/closed state. The active SESSION is already remembered per
 * project (see {@link persistence.ts} `activeSessionKey`) and restored by
 * `selectProject`; this module adds the two pieces that weren't persisted so a
 * round-trip through another project restores the FULL location, not just the
 * chat.
 *
 * The URL stays the single source of truth for the LIVE location — this is only a
 * per-scope MEMORY that the ChatPage sync reads when a scope route arrives with no
 * section (a fresh scope switch) and writes when the live section/sidebar change
 * while a session is open. Keyed by project id — a scope IS a project, so there is
 * no sentinel key for a project-less one any more.
 *
 * The reducers are pure (map in → map out, same ref on a no-op) so they're unit
 * tested without touching storage; the thin persistence wrappers own the
 * localStorage get/parse/catch + set/catch boilerplate.
 */

import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import type { StorageReader, StorageWriter } from '@localixai/mini-app-sdk/ui/storage'
import { isSectionId, type SectionId } from '@/shared/routing/routes'

const STORAGE_KEY = workspaceStorageKey('localix_workspace_location')

/** The remembered location for a single scope. A field is `null` when never set
 *  (so the caller can fall back to a global default rather than force a value). */
export interface ScopeLocation {
  /** The open right-sidebar section, or `null` for "no section open". */
  section: SectionId | null
  /** The left sidebar's open/closed state, or `null` when never recorded. */
  sidebarOpen: boolean | null
}

/** Location for every scope, keyed by project id. */
export type LocationsByScope = Record<string, ScopeLocation>

const EMPTY: ScopeLocation = { section: null, sidebarOpen: null }

/** Read the persisted per-scope location map. Tolerates corrupt/partial storage. */
export function loadLocations(storage?: StorageReader): LocationsByScope {
  const raw = loadJSON<unknown>(STORAGE_KEY, storage)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: LocationsByScope = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    out[key] = {
      section: isSectionId(typeof v.section === 'string' ? v.section : undefined)
        ? (v.section as SectionId)
        : null,
      sidebarOpen: typeof v.sidebarOpen === 'boolean' ? v.sidebarOpen : null,
    }
  }
  return out
}

/** Persist the per-scope location map (best-effort; private mode won't stick). */
export function saveLocations(map: LocationsByScope, storage?: StorageWriter): void {
  saveJSON(STORAGE_KEY, map, storage)
}

/** The remembered location for a scope — a fresh EMPTY value when never set. */
export function locationForScope(map: LocationsByScope, projectId: string | null): ScopeLocation {
  // An unresolved scope remembers nothing: it is the frame before a project is known,
  // not a place the user can be.
  return (projectId ? map[projectId] : undefined) ?? EMPTY
}

/**
 * Merge a partial location into a scope, returning the next map — or the SAME map
 * ref when nothing actually changed (so callers can skip a write). Undefined patch
 * fields leave the existing value untouched.
 */
export function withScopeLocation(
  map: LocationsByScope,
  projectId: string | null,
  patch: Partial<ScopeLocation>,
): LocationsByScope {
  if (!projectId) return map
  const key = projectId
  const prev = map[key] ?? EMPTY
  const next: ScopeLocation = {
    section: patch.section !== undefined ? patch.section : prev.section,
    sidebarOpen: patch.sidebarOpen !== undefined ? patch.sidebarOpen : prev.sidebarOpen,
  }
  if (next.section === prev.section && next.sidebarOpen === prev.sidebarOpen) return map
  return { ...map, [key]: next }
}

// ── Persistence-backed convenience wrappers (load → reduce → save) ────────────

/** The remembered location for a scope, read straight from storage. */
export function loadScopeLocation(
  projectId: string | null,
  storage?: StorageReader,
): ScopeLocation {
  return locationForScope(loadLocations(storage), projectId)
}

/** Remember the open section for a scope (`null` ⇒ no section open). */
export function rememberScopeSection(
  projectId: string | null,
  section: SectionId | null,
  storage?: StorageReader & StorageWriter,
): void {
  const map = loadLocations(storage)
  const next = withScopeLocation(map, projectId, { section })
  if (next !== map) saveLocations(next, storage)
}

/** Remember the left-sidebar open/closed state for a scope. */
export function rememberScopeSidebarOpen(
  projectId: string | null,
  sidebarOpen: boolean,
  storage?: StorageReader & StorageWriter,
): void {
  const map = loadLocations(storage)
  const next = withScopeLocation(map, projectId, { sidebarOpen })
  if (next !== map) saveLocations(next, storage)
}
