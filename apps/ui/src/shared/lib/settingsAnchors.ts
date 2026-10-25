import { parseLocalixUri, settingsUiUri } from '@localixai/mini-app-sdk/navigation'
import { currentSettingsTab, SETTINGS_STRING_TABS } from '@/shared/routing/routes'

export interface SettingsAnchorOptions {
  tab?: string
  anchor?: string
  entryId?: string
  /** Exact capability scope: '' is No project, otherwise a project id. */
  scope?: string
}

/** Canonical hierarchical URI for a settings tab or indexed setting. */
export function settingsTargetUri(options: SettingsAnchorOptions = {}): string {
  return settingsUiUri(options.tab, options)
}

export interface ParsedSettingsAnchor {
  tab: string
  anchor?: string
  entryId?: string
  scope?: string
}

export function parseSettingsAnchorUri(uri: string): ParsedSettingsAnchor | null {
  if (!uri || uri.length > 2_048) return null
  try {
    const parsed = parseLocalixUri(uri)
    if (parsed?.primitive !== 'ui') return null
    const queryEntries = Array.from(parsed.query.entries())
    if (queryEntries.some(([key]) => key !== 'scope') || parsed.query.getAll('scope').length > 1) {
      return null
    }
    const pathSegments = parsed.breadcrumbs
    if (pathSegments[0] !== 'settings') return null
    const segments = pathSegments.slice(1)
    if (segments.length > 3) return null
    const tab = segments[0] === 'root' ? 'preferences' : currentSettingsTab(segments[0] ?? '')
    const anchor = segments[1]
    const entryId = segments[2]
    if (
      !tab ||
      !(SETTINGS_STRING_TABS as readonly string[]).includes(tab) ||
      (anchor !== undefined && (!anchor || anchor.length > 256)) ||
      (entryId !== undefined && (!entryId || entryId.length > 256))
    ) {
      return null
    }
    const scope = parsed.query.has('scope') ? (parsed.query.get('scope') ?? '') : undefined
    if ((scope?.length ?? 0) > 256) return null
    return { tab, anchor, entryId, ...(scope === undefined ? {} : { scope }) }
  } catch {
    return null
  }
}
