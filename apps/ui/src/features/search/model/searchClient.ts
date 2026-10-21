/**
 * Client-only search domains — Settings (over the static `SETTINGS_INDEX`) and
 * Commands (over the palette command registry). These are pure UI NAVIGATION with no
 * server state, so they're computed in the browser and MERGED into the results
 * alongside the server groups (commands are a scope too). Hit ids use the
 * canonical `localix://ui/...` intents that
 * `searchResultActivate` routes. Pure + unit-tested.
 */
import type { SearchGroup, SearchHit } from '@localixai/api/client'
import { SETTINGS_INDEX } from '@/shared/lib/settings-index/settingsIndex'
import { settingsTargetUri } from '@/shared/lib/settingsAnchors'
import { ALL_SCOPE, type ScopeDef } from './scopes'
import { uiCommandUri, type UiCommandEntry } from '@/shared/contrib/uiCommands'
import type { UiLocationDescriptor } from '@localixai/plugin-sdk/ui'
import { scoreSearchFields } from '@localixai/search'
import { buildUiLocationUri, listUiLocations } from '@/shared/contrib/uiLocations'

/** A palette command as the search surface consumes it (subset of PaletteCommand). */
export type SearchCommandEntry = UiCommandEntry

/** Compatibility facade for callers/tests; all client domains use the shared relevance engine. */
export function clientScore(haystack: string, needle: string): number {
  return scoreSearchFields([{ text: haystack }], needle)
}

function bestScore(fields: Array<string | undefined>, needle: string): number {
  return scoreSearchFields(
    fields.map((text) => ({ text })),
    needle,
  )
}

/** Settings hits over the static index → canonical Localix settings ids. */
export function searchSettings(query: string, limit = 50): SearchHit[] {
  const q = query.trim()
  if (!q) return []
  const hits: SearchHit[] = []
  for (const e of SETTINGS_INDEX) {
    const score = bestScore([e.title, e.description, ...(e.keywords ?? [])], q)
    if (score <= 0) continue
    hits.push({
      id: settingsTargetUri({ tab: e.tab, anchor: e.anchor, entryId: e.id }),
      domain: 'settings',
      title: e.title,
      subtitle: e.tabLabel,
      icon: 'settings',
      score,
    })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Command hits over the passed palette commands → canonical Localix command ids. */
export function searchCommands(
  query: string,
  commands: SearchCommandEntry[],
  limit = 50,
): SearchHit[] {
  const q = query.trim()
  if (!q) return []
  const hits: SearchHit[] = []
  for (const c of commands) {
    const score = bestScore([c.label, c.group, ...(c.keywords ?? [])], q)
    if (score <= 0) continue
    hits.push({
      id: uiCommandUri(c),
      domain: 'commands',
      title: c.label,
      subtitle: c.group,
      icon: 'command',
      score,
    })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Addressable frontend surfaces; descriptors contain no models, plugins, or result data. */
export function searchUiLocations(
  query: string,
  locations: readonly UiLocationDescriptor[] = listUiLocations({ exposure: 'search' }),
  limit = 50,
): SearchHit[] {
  const q = query.trim()
  if (!q) return []
  return locations
    .flatMap((location): SearchHit[] => {
      const score = bestScore(
        [location.title, location.description, location.group, ...location.keywords],
        q,
      )
      const uri = score > 0 ? buildUiLocationUri(location.id) : null
      return uri
        ? [
            {
              id: uri,
              domain: 'ui',
              title: location.title,
              subtitle: location.group,
              icon: location.icon ?? 'command',
              score,
            },
          ]
        : []
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}

/** Build client-only groups from the static settings index and live UI registries. */
export function buildClientGroups(opts: {
  query: string
  commands?: SearchCommandEntry[]
  limit?: number
}): SearchGroup[] {
  const limit = opts.limit ?? 6
  const groups: SearchGroup[] = []
  const settings = searchSettings(opts.query)
  if (settings.length)
    groups.push({
      domain: 'settings',
      title: 'Settings',
      icon: 'settings',
      hits: settings.slice(0, limit),
      total: settings.length,
    })
  const locations = searchUiLocations(opts.query)
  if (locations.length) {
    groups.push({
      domain: 'ui',
      title: 'Open UI',
      icon: 'command',
      hits: locations.slice(0, limit),
      total: locations.length,
    })
  }
  if (opts.commands) {
    const cmds = searchCommands(opts.query, opts.commands)
    if (cmds.length)
      groups.push({
        domain: 'commands',
        title: 'Commands',
        icon: 'command',
        hits: cmds.slice(0, limit),
        total: cmds.length,
      })
  }
  return groups
}

/** Merge client groups with server groups honouring the active scope. */
export function mergeClientGroups(
  scope: ScopeDef,
  serverGroups: SearchGroup[],
  clientGroups: SearchGroup[],
): SearchGroup[] {
  if (scope.clientOnly) return clientGroups.filter((g) => g.domain === scope.id)
  if (scope.id !== ALL_SCOPE.id) return serverGroups
  return [...serverGroups, ...clientGroups]
}
