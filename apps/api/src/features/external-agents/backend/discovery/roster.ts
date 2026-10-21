/**
 * The roster: ONE list holding both live delegations and historical sessions, distinguished by
 * state rather than by living on separate screens.
 *
 * That is the product requirement, and it has a structural consequence worth stating: a live
 * delegation and its own transcript on disk are the SAME row, because both are keyed on
 * `(provider, nativeSessionId)` once correlation succeeds. Before correlation the live entry
 * carries a pending key and appears as its own row; when it correlates, the two collapse into one.
 * Nothing de-duplicates by title or path — only by key.
 *
 * Bounding is mandatory and counted. `total` is the number of rows that matched the filter and
 * `withheld` is how many of those were not returned; the UI shows both. Silently returning the
 * first N is the failure mode this exists to prevent.
 */

import type { Bounded, RosterRow, RosterQuery, SessionSummary } from '../../shared/contracts'
import { MAX_ROSTER_LIMIT, sessionHasParent, sessionUsedModel } from '../../shared/contracts'
import type { LiveStore } from '../live/store'
import { waitedKeys } from '../live/waiters'

export const DEFAULT_ROSTER_LIMIT = 200

export interface RosterInput {
  readonly summaries: readonly SessionSummary[]
  readonly live: LiveStore
  readonly query: RosterQuery
  /** Sub-agent transcripts are hidden by default: they can outnumber roots several to one. */
  readonly includeChildren?: boolean
}

function matchesText(row: SessionSummary, needle: string): boolean {
  /**
   * The KEY is in the haystack, because it is the form every answer prints an identity in.
   *
   * The id and the provider were both here and their joined form was not, so pasting a key — which is
   * what `stats` lists under "Heaviest sessions", what a digest footer names, and what every other
   * action takes — matched nothing at all. A search that advertises "id" and rejects the id as
   * presented is a dead end a reader has no way to diagnose.
   */
  const hay =
    `${row.title}\n${row.cwd ?? ''}\n${row.nativeSessionId}\n${row.provider}\n${row.key}`.toLowerCase()
  // Every whitespace-separated term must appear somewhere: closer to how people actually narrow a
  // list than a single-substring match.
  for (const term of needle.toLowerCase().split(/\s+/)) {
    if (term && !hay.includes(term)) return false
  }
  return true
}

/**
 * A NAME for a delegation that has not correlated to a transcript yet.
 *
 * It used to be `entry.launchCommand` verbatim, and that command runs to about 1.7 KB: the launch
 * line carries the whole rendered report protocol as one `--append-system-prompt` argument. So an
 * uncorrelated delegation put more into a roster row title — printed on its own line by the tool —
 * than several ordinary rows of the answer take together.
 *
 * The pieces for a real name are already declared: `LOCALIX_AGENT_CWD` exists so correlation can tell
 * two delegations of one provider apart, and the directory is what a reader tells them apart by too.
 */
function delegationTitle(entry: { provider: string; cwd?: string }): string {
  const where = entry.cwd?.match(/[^/]+(?=\/?$)/u)?.[0]
  return where ? `${entry.provider} in ${where}` : `${entry.provider} delegation`
}

export function buildRoster(input: RosterInput): Bounded<RosterRow> {
  const { summaries, live, query } = input
  const byKey = new Map<string, RosterRow>()

  for (const summary of summaries) {
    byKey.set(summary.key, { ...summary, state: 'idle', authority: 'none' })
  }

  // Live entries are folded in AFTER, so a correlated delegation upgrades its own historical row
  // in place rather than producing a duplicate.
  for (const entry of live.list()) {
    const key = live.keyOf(entry)
    const existing = byKey.get(key)
    const base: RosterRow = existing ?? {
      key,
      provider: entry.provider,
      nativeSessionId: entry.nativeSessionId ?? `pending-terminal-${entry.terminalId}`,
      title: delegationTitle(entry),
      updatedAt: entry.lastScreenAt,
      sourcePath: `terminal:${entry.terminalId}`,
      state: entry.state,
      authority: entry.explain.authority,
    }
    // Dropped from `base` rather than left to be overwritten: two live entries can correlate to one
    // key, and a stale `true` from the first would outlive the second's matched rule.
    const { stateFallback: _prior, ...carried } = base
    byKey.set(key, {
      ...carried,
      state: entry.state,
      authority: entry.explain.authority,
      terminalId: entry.terminalId,
      updatedAt: Math.max(base.updatedAt, entry.lastScreenAt),
      ...(entry.explain.fallbackReason == null ? {} : { stateFallback: true }),
      lastChangeAt: entry.lastChangeAt,
    })
  }

  // A session something is WAITING on is the reason the workspace looks idle, so it is marked
  // rather than left to be inferred from a stopped turn.
  const awaited = waitedKeys()
  let rows = [...byKey.values()].map((row) =>
    awaited.has(row.key) ? { ...row, awaited: true } : row,
  )

  // Asking for a parent's children is asking for children: the default that hides them cannot also
  // apply, or the filter has exactly one answer and it is the empty one.
  if (!input.includeChildren && !query.parentKey) {
    // A LIVE child is always kept: it is running right now, and a running agent hidden by a
    // default filter is the one row whose absence the user would read as "it never started".
    rows = rows.filter((r) => !r.parentNativeSessionId || r.terminalId)
  }
  if (query.providers && query.providers.length > 0) {
    const allowed = new Set(query.providers)
    rows = rows.filter((r) => allowed.has(r.provider))
  }
  if (query.states && query.states.length > 0) {
    const allowed = new Set(query.states)
    rows = rows.filter((r) => allowed.has(r.state))
  }
  if (query.parentKey) {
    rows = rows.filter((r) => sessionHasParent(r, query.parentKey as string))
  }
  if (query.cwdPrefix) rows = rows.filter((r) => r.cwd?.startsWith(query.cwdPrefix as string))
  // Both places a model is recorded, through the predicate the statistics use — see shared/contracts.
  if (query.model) rows = rows.filter((r) => sessionUsedModel(r, query.model as string))
  if (query.text?.trim()) {
    const needle = query.text.trim()
    rows = rows.filter((r) => matchesText(r, needle))
  }

  // Live first, then most recently updated. A running agent is always the thing you want to see.
  rows.sort((a, b) => {
    const liveDelta = Number(Boolean(b.terminalId)) - Number(Boolean(a.terminalId))
    if (liveDelta !== 0) return liveDelta
    return b.updatedAt - a.updatedAt
  })

  const total = rows.length
  const offset = Math.max(0, query.offset ?? 0)
  const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_ROSTER_LIMIT), MAX_ROSTER_LIMIT)
  const items = rows.slice(offset, offset + limit)
  return { items, total, withheld: Math.max(0, total - offset - items.length) }
}
