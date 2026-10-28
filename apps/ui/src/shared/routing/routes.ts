/**
 * Single source of truth for the app's URL surface.
 *
 * `ROUTE_PATTERNS` are the path patterns declared once in the router tree;
 * the `*Path` builders are the only sanctioned way to construct URLs, so a
 * pattern change never drifts from the strings scattered across the UI.
 *
 * URL-derived types (`SectionId`) live here too: they describe the address bar,
 * so the route surface owns them. Settings/Stats/mini app views are inspector
 * panels (no URL) — see the inspector store. `SettingsTabId` is the panel's
 * internal sub-tab selector and lives here as a shared type.
 */

import { railSectionRegistry } from '@/shared/contrib/uiContrib'

// Core rail sections are literals; subsystem rail sections (a bundled container workbench, …)
// are supplied by the open `railSectionRegistry`, so their ids ride the `(string &
// {})` member — core names no subsystem section. `isSectionId` validates a raw id
// against the core literals PLUS whatever the registry currently holds.
export type SectionId = 'files' | 'jobs' | (string & {})

export const SETTINGS_STRING_TABS = [
  'preferences',
  'editor',
  'shortcuts',
  'permissions',
  'project',
  'models',
  'model-list',
  'system',
  'context',
  'diagnostics',
] as const

/** A settings string tab, or a project-scoped settings view. */
export type SettingsTabId = (typeof SETTINGS_STRING_TABS)[number] | { kind: 'project'; id: string }

export const ROUTE_PATTERNS = {
  index: '/',
  // Hierarchical scope→session addressing: the project scope is part of the
  // path, so a link identifies WHERE a chat lives, not just its id.
  projectChat: 'project/:projectId/:sessionId?/:section?',
  catchAll: '*',
} as const

/**
 * Build a hierarchical scope→session URL. The section (files/jobs/…) is the trailing
 * segment.
 *
 *   scopePath('p1')               → /project/p1
 *   scopePath('p1', 's1')         → /project/p1/s1
 *   scopePath('p1', 's1','files') → /project/p1/s1/files
 *
 * There is no project-less spelling. A `/global` scope used to own the sessions the user
 * had not filed anywhere; every session now belongs to a project (the default one when the
 * user picked none), so a scope with no project id would address a place that cannot hold
 * anything.
 */
export function scopePath(
  projectId: string,
  sessionId?: string | null,
  section?: SectionId | null,
): string {
  const base = `/project/${projectId}`
  if (!sessionId) return base
  return section ? `${base}/${sessionId}/${section}` : `${base}/${sessionId}`
}

/**
 * Which project scope a session navigation targets.
 *
 * `undefined` means "the caller didn't say — keep the URL's scope"; a string is an explicit
 * target. `null` (the old Global scope) is no longer a value a caller can mean, and the
 * current scope is only null before the roster has resolved one.
 */
export function resolveNavScope(
  explicit: string | undefined,
  current: string | null,
): string | null {
  return explicit !== undefined ? explicit : current
}

export function isSectionId(value: string | undefined): value is SectionId {
  if (value === undefined) return false
  // Core rail sections, plus any id contributed through the open rail-section
  // registry (bundled subsystems register themselves there).
  if (value === 'files' || value === 'jobs') return true
  // Installed third-party mini app views are NOT rail sections — they open as
  // work-item tabs, addressed by their own location uri, not a section id.
  return railSectionRegistry.list().some((s) => s.id === value)
}

export function parseSettingsTab(
  tab: string | undefined,
  projectId: string | undefined,
): SettingsTabId {
  if (projectId) return { kind: 'project', id: projectId }
  if (tab && (SETTINGS_STRING_TABS as readonly string[]).includes(tab)) return tab as SettingsTabId
  return 'preferences'
}
