import type { ResourceNode } from '@localixai/mini-app-sdk/backend'
import {
  buildResourceUri,
  linkAction,
  plural,
  truncationNotice,
} from '@localixai/mini-app-sdk/backend'
import { RESOURCE_BROWSE_LIMIT } from '@localixai/mini-app-sdk/resource-refs'
import { EXTERNAL_AGENT_RESOURCE_PROVIDER } from '../shared/resource-provider-id'
import type { RosterRow } from '../shared/contracts'

export const PROVIDER = EXTERNAL_AGENT_RESOURCE_PROVIDER
/** Reserved marker introducing the project level — never a native session id. */
export const PROJECT_SEG = 'cwd'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export const providerUri = (provider: string): string => buildResourceUri(PROVIDER, [provider])
export const projectUri = (provider: string, cwd: string): string =>
  buildResourceUri(PROVIDER, [provider, PROJECT_SEG, cwd])
const sessionUri = (provider: string, nativeSessionId: string): string =>
  buildResourceUri(PROVIDER, [provider, nativeSessionId])

export { plural }

export const isoStamp = (at: number): string =>
  Number.isFinite(at) ? new Date(at).toISOString() : '(unknown)'

/** Menu-width age. Past a month a duration stops meaning anything, so it becomes a date. */
function ageLabel(at: number, now: number): string {
  const delta = now - at
  if (!Number.isFinite(delta) || delta < MINUTE_MS) return 'just now'
  if (delta < HOUR_MS) return `${Math.floor(delta / MINUTE_MS)}m ago`
  if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)}h ago`
  if (delta < 30 * DAY_MS) return `${Math.floor(delta / DAY_MS)}d ago`
  return isoStamp(at).slice(0, 10)
}

export function matchesQuery(query: string, ...fields: string[]): boolean {
  if (!query) return true
  const needle = query.toLocaleLowerCase()
  return fields.some((field) => field.toLocaleLowerCase().includes(needle))
}

/**
 * Cap a level and SAY so in-band. Every caller filters first: capping a filtered list is a page,
 * whereas filtering a capped one silently hides the matches the cap already dropped.
 */
export function capped(
  nodes: ResourceNode[],
  parentUri: string,
  what: string,
  query: string,
): ResourceNode[] {
  if (nodes.length <= RESOURCE_BROWSE_LIMIT) return nodes
  const kept = nodes.slice(0, RESOURCE_BROWSE_LIMIT)
  return [...kept, truncationNotice(parentUri, kept.length, nodes.length, what, query || undefined)]
}

export function sessionNode(row: RosterRow, now: number): ResourceNode {
  const detail = [ageLabel(row.updatedAt, now)]
  if (row.messageCount !== undefined) detail.push(plural(row.messageCount, 'event'))
  return {
    uri: sessionUri(row.provider, row.nativeSessionId),
    label: row.title.trim() || row.nativeSessionId,
    detail: detail.join(' · '),
    hasChildren: false,
    icon: row.provider,
    actions: linkAction('Link this session'),
  }
}

export function projectNode(
  provider: string,
  cwd: string,
  rows: readonly RosterRow[],
  now: number,
): ResourceNode {
  const newest = rows.reduce((latest, row) => Math.max(latest, row.updatedAt), 0)
  const slash = cwd.lastIndexOf('/')
  // The basename is the readable half of a long absolute path; the full path stays in `detail` so
  // two projects with the same basename are still told apart, and so typing the path still matches.
  const base = slash >= 0 && slash < cwd.length - 1 ? cwd.slice(slash + 1) : cwd
  return {
    uri: projectUri(provider, cwd),
    label: base,
    detail: `${plural(rows.length, 'session')} · ${ageLabel(newest, now)} · ${cwd}`,
    hasChildren: true,
    navigationOnly: true,
    icon: 'folder',
  }
}
