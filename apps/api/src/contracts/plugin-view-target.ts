/**
 * A plugin's workbench view as a `browser` target: `plugin:<name>`.
 *
 * The agent that builds a plugin could not look at it. The plugin's UI renders inside the Localix
 * workbench, not in a page with a URL, so the browser tool — the one way an agent sees and drives
 * a UI — had nothing to open: it was pointed at the API's own origin, got a JSON 404 and hung
 * on a page probe that never came. The view is ADDRESSED instead. `open` accepts this target
 * without serving anything, and every command for it is claimed by the workbench, which opens the
 * plugin's view and runs the command against that panel.
 *
 * The API writes the target and the workbench reads it, so both parse it here and cannot disagree
 * about what one is. Browser-safe: no imports beyond the manifest's name rule.
 */
import { PLUGIN_NAME_RE } from '@localixai/mini-app-sdk/manifest-primitives'

export const PLUGIN_VIEW_PREFIX = 'plugin:'

export function pluginViewTarget(name: string): string {
  return `${PLUGIN_VIEW_PREFIX}${name}`
}

/** The plugin a target names, or null when it is not a plugin view (a URL, a tab ID). */
export function parsePluginViewTarget(target: string | null | undefined): string | null {
  const value = target?.trim()
  if (!value?.startsWith(PLUGIN_VIEW_PREFIX)) return null
  const name = value.slice(PLUGIN_VIEW_PREFIX.length).replace(/^\/+/u, '')
  return PLUGIN_NAME_RE.test(name) ? name : null
}
