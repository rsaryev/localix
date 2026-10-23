/**
 * A mini app's workbench view as a `browser` target: `mini-app:<name>`.
 *
 * The agent that builds a mini app could not look at it. The app's screens render inside the
 * Localix workbench, not in a page with a URL, so the browser tool — the one way an agent sees and
 * drives a UI — had nothing to open: it was pointed at the API's own origin, got a JSON 404 and
 * hung on a page probe that never came. The view is ADDRESSED instead. `open` accepts this target
 * without serving anything, and every command for it is claimed by the workbench, which opens the
 * mini app's view and runs the command against that panel.
 *
 * The API writes the target and the workbench reads it, so both parse it here and cannot disagree
 * about what one is. Browser-safe: no imports beyond the manifest's name rule.
 */
import { MINI_APP_NAME_RE } from '@localixai/mini-app-sdk/manifest-primitives'

export const MINI_APP_VIEW_PREFIX = 'mini-app:'

export function miniAppViewTarget(name: string): string {
  return `${MINI_APP_VIEW_PREFIX}${name}`
}

/** The mini app a target names, or null when it is not a mini app view (a URL, a tab ID). */
export function parseMiniAppViewTarget(target: string | null | undefined): string | null {
  const value = target?.trim()
  if (!value?.startsWith(MINI_APP_VIEW_PREFIX)) return null
  const name = value.slice(MINI_APP_VIEW_PREFIX.length).replace(/^\/+/u, '')
  return MINI_APP_NAME_RE.test(name) ? name : null
}
