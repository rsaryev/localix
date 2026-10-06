/**
 * EXTERNAL AGENT resource provider — the tree behind `localix://resource/external-agent`, which
 * `plugin.json` has advertised since day one while nothing implemented it. Core owns the seam
 * (`BackendSubsystem.resourceProvider` → the resource-ref registry), so this one file is what makes
 * an external coding-agent session a first-class `@resource`: drillable in the composer, insertable
 * as a chip, and expanded at send time into a bounded digest rather than a transcript dump.
 *
 * URI grammar (positional; `cwd` is a RESERVED marker segment, the way the vault provider reserves
 * `items`. It is what keeps a project container distinguishable from a session leaf by SHAPE, so
 * the two can never be confused even if a provider one day mints a native id spelled `cwd`):
 *   localix://resource/external-agent/<provider>                    → one provider adapter (root)
 *   localix://resource/external-agent/<provider>/cwd/<dir>          → one project (container)
 *   localix://resource/external-agent/<provider>/<nativeSessionId>  → one session (leaf, expands)
 *
 * `<provider>` is the ADAPTER id (`claude-code`, `codex`, `opencode`, `gemini-cli`) — the same half
 * of the `<provider>:<nativeSessionId>` key the `external_agent_sessions` tool takes, so a URI and a tool
 * call name one session without a translation table in between.
 *
 * Segments are minted by `buildResourceUri`, which percent-encodes each one, and read back with
 * `decodeResourceSegment`. Pre-encoding with `encodeResourceSegment` would double-encode a cwd's
 * slashes and the identity would stop round-tripping.
 */

import type {
  ResourceExpansion,
  ResourceNode,
  ResourceRefProvider,
} from '@localixai/plugin-sdk/backend'
import {
  buildResourceUri,
  decodeResourceSegment,
  linkAction,
  noticeNode,
  providerSegments,
  truncationNotice,
} from '@localixai/plugin-sdk/backend'
// The shared response cap and the scope type are reachable only through the resource-refs entry
// point — the `/backend` barrel re-exports the helpers but not these. Importing the cap rather than
// re-spelling `50` is what keeps this level's page size and the registry's in step.
import type { ResourceRefScope } from '@localixai/plugin-sdk/resource-refs'
import { RESOURCE_BROWSE_LIMIT } from '@localixai/plugin-sdk/resource-refs'

import { PROVIDER_ADAPTERS, adapterFor } from './adapters/registry'
import { MAX_ROSTER_LIMIT, MAX_TRANSCRIPT_EVENTS } from '../shared/contracts'
import { isPendingKey } from './live/store'
import { linkKeyOf } from '../shared/identity'
import { toolNameOf, toolNamesByCallId } from './transcript/tool-names'
import { EXTERNAL_AGENT_RESOURCE_PROVIDER } from '../shared/resource-provider-id'
import type {
  Bounded,
  ProviderStatus,
  RosterQuery,
  RosterRow,
  TranscriptEvent,
  TranscriptSlice,
} from '../shared/contracts'

const PROVIDER = EXTERNAL_AGENT_RESOURCE_PROVIDER
/** Reserved marker introducing the project level — never a native session id. */
const PROJECT_SEG = 'cwd'

/**
 * Narrow structural port over `AgentSessionsService`: the three reads this tree needs, and nothing
 * that could start, link or mutate anything. Depending on the shape rather than the singleton is
 * what lets every level be tested without a real agent history on disk.
 */
export interface ExternalAgentResourceService {
  providers(): Promise<readonly ProviderStatus[]>
  roster(query: RosterQuery, localixSessionId?: string): Promise<Bounded<RosterRow>>
  transcript(
    key: string,
    maxEvents?: number,
    maxCharsPerEvent?: number,
    tail?: boolean,
  ): Promise<TranscriptSlice | null>
}

/**
 * Mirrors core's own `@session:` digest (`projects/session-digest.ts`) so an external session reads
 * like a linked Localix one, and lands inside the 3000-char budget `expand-refs` gives kind
 * `resource`. The registry's hard ceiling (RESOURCE_EXPANSION_MAX_BYTES, 64 KiB) is far above this
 * — a digest that needed it would not be a digest.
 */
const DIGEST_MAX_TURNS = 6
const DIGEST_PER_TURN_CHARS = 400
const DIGEST_TARGET_CHARS = 3_000

/**
 * The window this digest reads, from the session's END (`tail: true`).
 *
 * Adapters used to bound a read from the head only, so a session longer than this window showed its
 * MIDDLE while looking like its end. They now take either end for the same cost — `total` already
 * forces a full walk of the source, so stopping early never saved the I/O (adapters/event-window.ts).
 * Measured on the largest session per provider: 39 ms head vs 37 ms tail on a 53 MB codex rollout.
 *
 * The window stays bounded because each event is clipped and the digest only prints a handful of
 * turns from it; what it does not show is stated in the range line rather than implied.
 */
const DIGEST_SCAN_EVENTS = 1_000
const DIGEST_SCAN_EVENT_CHARS = 600

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

const providerUri = (provider: string): string => buildResourceUri(PROVIDER, [provider])
const projectUri = (provider: string, cwd: string): string =>
  buildResourceUri(PROVIDER, [provider, PROJECT_SEG, cwd])
const sessionUri = (provider: string, nativeSessionId: string): string =>
  buildResourceUri(PROVIDER, [provider, nativeSessionId])

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

const isoStamp = (at: number): string =>
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

function matchesQuery(query: string, ...fields: string[]): boolean {
  if (!query) return true
  const needle = query.toLocaleLowerCase()
  return fields.some((field) => field.toLocaleLowerCase().includes(needle))
}

/**
 * Cap a level and SAY so in-band. Every caller filters first: capping a filtered list is a page,
 * whereas filtering a capped one silently hides the matches the cap already dropped.
 */
function capped(
  nodes: ResourceNode[],
  parentUri: string,
  what: string,
  query: string,
): ResourceNode[] {
  if (nodes.length <= RESOURCE_BROWSE_LIMIT) return nodes
  const kept = nodes.slice(0, RESOURCE_BROWSE_LIMIT)
  return [...kept, truncationNotice(parentUri, kept.length, nodes.length, what, query || undefined)]
}

function sessionNode(row: RosterRow, now: number): ResourceNode {
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

function projectNode(
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

function turnLine(event: TranscriptEvent, toolNames: ReadonlyMap<string, string>): string {
  const named = toolNameOf(event, toolNames)
  const role = event.role === 'tool' && named ? `tool:${named}` : event.role
  const text = event.text.replace(/\s+/g, ' ').trim()
  const clipped =
    text.length > DIGEST_PER_TURN_CHARS
      ? `${text.slice(0, DIGEST_PER_TURN_CHARS).trimEnd()}…`
      : text
  return `[${role}] ${clipped}`
}

/**
 * The COMPACT digest an expanded ref inserts: provenance, a bounded tail of turns, and the sentence
 * that tells the model how to read the rest. It never inlines a transcript — the point of the ref
 * is that the model can decide whether the full read is worth its budget.
 */
function digest(slice: TranscriptSlice): string {
  const { summary, events, total, key } = slice
  // Not every provider records a start; the first timestamped event is the next best evidence, and
  // when there is neither the line says so rather than passing the end off as a range.
  const startedAt = summary.startedAt ?? events.find((e) => e.timestamp)?.timestamp
  const header = [
    `## ${summary.provider} — ${summary.title.trim() || summary.nativeSessionId}`,
    `key: ${key}`,
    [summary.cwd ? `cwd: ${summary.cwd}` : null, `source: ${summary.sourcePath}`]
      .filter((part): part is string => part !== null)
      .join('    '),
    `range: ${startedAt === undefined ? '(start unknown)' : isoStamp(startedAt)} → ${isoStamp(summary.updatedAt)}    events: ${total}`,
  ]
  /**
   * "Full transcript" was an overclaim for exactly the sessions this digest matters most for. One
   * `transcript` read returns at most `MAX_TRANSCRIPT_EVENTS`, so on the largest session here — 8,753
   * events — it answers with 2,000 of them and the pointer promised the rest. A session that fits says
   * "full"; one that does not names the walk instead, which is the same correction already made to the
   * transcript answer and the import note.
   */
  const oneRead = total <= MAX_TRANSCRIPT_EVENTS
  const reach = oneRead
    ? `Full transcript: external_agent_sessions { action: "transcript", key: "${key}" }`
    : `This session is ${total} events — more than one read returns. Walk it with external_agent_sessions { action: "transcript", key: "${key}", from: 0 }, raising "from" by the events returned; "tail: true" reads the end`
  const footer = `(Compact digest of an external ${summary.provider} session. ${reach}. Several sessions at once: { action: "context", keys: [...] }. Live state: { action: "explain", key: "${key}" }.)`

  if (events.length === 0) {
    return [...header, '', '(No readable turns in this transcript.)', '', footer].join('\n')
  }

  // Walk backwards from the newest turn: the tail is what a reader wants, and spending the budget
  // newest-first means an oversized early turn can never crowd out the recent ones.
  // Built from the whole window, so a shown result can be named by a call that was read but
  // not shown — see `toolNamesByCallId`.
  const toolNames = toolNamesByCallId(events)
  const budget = DIGEST_TARGET_CHARS - header.join('\n').length - footer.length
  const lines: string[] = []
  let used = 0
  let firstShown = events.length - 1
  for (let index = events.length - 1; index >= 0 && lines.length < DIGEST_MAX_TURNS; index -= 1) {
    const line = turnLine(events[index], toolNames)
    if (used + line.length > budget && lines.length > 0) break
    lines.push(line)
    used += line.length + 1
    firstShown = index
  }
  lines.reverse()

  /**
   * A 1-based range over the WHOLE session, read from each event's own `ordinal` rather than from
   * its index here — the window holds the session's END, so an index into it is not a position in
   * the conversation.
   *
   * This used to read from the head, which meant a session longer than the scan window showed its
   * MIDDLE while looking like its end, and it stated the gap as two numbers for a reader to
   * subtract. Both are gone: the digest now genuinely ends where the session does, and what it
   * omits — the earlier turns — is said in words and is reachable, because `transcript` reads from
   * the start. Every other bounded surface here does the same (the roster's "Showing 50 of 104",
   * the tool's "399 not shown"), and this is the one whose reader is a model.
   */
  const from = (events[firstShown]?.ordinal ?? 0) + 1
  const to = (events[events.length - 1]?.ordinal ?? 0) + 1
  const earlier = from - 1
  const range =
    earlier === 0
      ? `turns ${from}–${to} of ${total}:`
      : `turns ${from}–${to} of ${total} — the session's most recent; the ${earlier} earlier turns are not shown:`
  return [...header, '', range, ...lines, '', footer].join('\n')
}

export function createExternalAgentResourceProvider(
  service: ExternalAgentResourceService,
  now: () => number = Date.now,
): ResourceRefProvider {
  /**
   * One roster read per level. The query is pushed DOWN into the roster filter (which matches
   * title, cwd, native id and provider) so filtering happens across the whole scan and only the
   * result is capped — a session past the page is still reachable by typing.
   */
  async function sessionsOf(
    provider: string,
    query: string,
    scope?: ResourceRefScope,
  ): Promise<readonly RosterRow[]> {
    const { items } = await service.roster(
      { providers: [provider], text: query || undefined, limit: MAX_ROSTER_LIMIT },
      scope?.sessionId,
    )
    // A live delegation that has not correlated yet has no transcript to expand, and its key is a
    // placeholder that disappears the moment correlation succeeds. Offering it as a ref would mint
    // an identity that stops existing a few seconds later.
    return items.filter((row) => !isPendingKey(row.key) && row.nativeSessionId)
  }

  async function rootNodes(query: string): Promise<ResourceNode[]> {
    const root = buildResourceUri(PROVIDER)
    const statuses = await service.providers()
    const nodes: ResourceNode[] = []
    const notices: ResourceNode[] = []
    for (const status of statuses) {
      // A scan that failed is a fact about this machine, not an absence. Swallowing it would make a
      // permissions problem look exactly like "you have never used that agent".
      if (status.error) {
        notices.push(
          noticeNode(root, `${status.displayName} history could not be read`, status.error),
        )
      }
      if (status.sessionCount === 0) continue
      if (!matchesQuery(query, status.displayName, status.provider)) continue
      nodes.push({
        uri: providerUri(status.provider),
        label: status.displayName,
        detail: `${plural(status.sessionCount, 'session')}${status.verified ? '' : ' · unverified adapter'}`,
        hasChildren: true,
        navigationOnly: true,
        icon: status.provider,
      })
    }
    if (nodes.length === 0) {
      notices.push(
        noticeNode(
          root,
          query
            ? `No agent history matches "${query}"`
            : 'No external agent history on this machine',
          `Checked ${PROVIDER_ADAPTERS.map((adapter) => adapter.displayName).join(', ')}`,
        ),
      )
    }
    return [...capped(nodes, root, 'providers', query), ...notices]
  }

  async function providerNodes(
    provider: string,
    query: string,
    scope?: ResourceRefScope,
  ): Promise<ResourceNode[]> {
    const adapter = adapterFor(provider)
    if (!adapter) return []
    const base = providerUri(provider)
    const rows = await sessionsOf(provider, query, scope)
    if (rows.length === 0) {
      return [
        noticeNode(
          base,
          query
            ? `No ${adapter.displayName} sessions match "${query}"`
            : `No ${adapter.displayName} sessions on this machine`,
          'This provider was found, but its history is empty here',
        ),
      ]
    }

    const byCwd = new Map<string, RosterRow[]>()
    const rootless: RosterRow[] = []
    for (const row of rows) {
      if (!row.cwd) {
        rootless.push(row)
        continue
      }
      const bucket = byCwd.get(row.cwd)
      if (bucket) bucket.push(row)
      else byCwd.set(row.cwd, [row])
    }

    // Gemini CLI records no working directory at all. Inventing a project level for it would cost a
    // click that reveals nothing, so its sessions sit directly under the provider — and a provider
    // that records a cwd for only SOME sessions shows the remainder here too, rather than losing
    // them behind containers they can never belong to.
    const at = now()
    const nodes = [
      ...[...byCwd].map(([cwd, group]) => projectNode(provider, cwd, group, at)),
      ...rootless.map((row) => sessionNode(row, at)),
    ]
    return capped(nodes, base, byCwd.size > 0 ? 'projects' : 'sessions', query)
  }

  async function projectSessionNodes(
    provider: string,
    cwd: string,
    query: string,
    scope?: ResourceRefScope,
  ): Promise<ResourceNode[]> {
    const base = projectUri(provider, cwd)
    // Exact cwd, never a prefix: with a prefix a session in a nested checkout would appear under
    // two projects, and the counts on both would be wrong.
    const rows = (await sessionsOf(provider, query, scope)).filter((row) => row.cwd === cwd)
    if (rows.length === 0) {
      return [
        noticeNode(
          base,
          query ? `No sessions here match "${query}"` : 'No sessions left in this project',
          cwd,
        ),
      ]
    }
    const at = now()
    return capped(
      rows.map((row) => sessionNode(row, at)),
      base,
      'sessions',
      query,
    )
  }

  return {
    provider: PROVIDER,
    title: 'External Agents',

    // `userId` is unused on purpose: an agent history is a machine-local file tree, owned by the OS
    // user running Localix. There is no per-user scoping to apply and pretending otherwise would
    // imply an isolation this data does not have.
    async listChildren(_userId, parentUri, query, scope): Promise<ResourceNode[]> {
      const needle = query?.trim() ?? ''
      if (parentUri === null) return rootNodes(needle)

      const segments = providerSegments(PROVIDER, parentUri)
      // The ownership guard: another provider's URI (or a malformed one) is NOT ours to answer.
      if (!segments) return []
      if (segments.length === 0) return rootNodes(needle)

      const decoded = segments.map(decodeResourceSegment)
      const provider = decoded[0]
      if (decoded.length === 1) return providerNodes(provider, needle, scope)
      if (decoded.length === 3 && decoded[1] === PROJECT_SEG) {
        return projectSessionNodes(provider, decoded[2], needle, scope)
      }
      // Anything else is a session leaf (or a path we never mint): leaves have no children.
      return []
    },

    async expand(_userId, uri): Promise<ResourceExpansion> {
      const segments = providerSegments(PROVIDER, uri)
      if (!segments || segments.length === 0) {
        return { ok: false, error: 'not an external agent resource' }
      }
      const decoded = segments.map(decodeResourceSegment)
      const provider = decoded[0]
      const adapter = adapterFor(provider)
      if (!adapter) {
        return {
          ok: false,
          error: `unknown agent provider "${provider}". Known providers: ${PROVIDER_ADAPTERS.map((a) => a.id).join(', ')}.`,
        }
      }
      if (decoded.length === 1 || (decoded.length === 3 && decoded[1] === PROJECT_SEG)) {
        return {
          ok: false,
          error: `that is a group of ${adapter.displayName} sessions, not a session. Drill into it and link one session.`,
        }
      }
      if (decoded.length !== 2) return { ok: false, error: 'not an external agent session' }

      const key = linkKeyOf({ provider, nativeSessionId: decoded[1] })
      // The TAIL of the session, because that is what a digest of a linked session is for. This
      // used to read from the head, so anything longer than the window showed its middle and the
      // recent work was unreachable; the window costs the same at either end (event-window.ts).
      const slice = await service.transcript(key, DIGEST_SCAN_EVENTS, DIGEST_SCAN_EVENT_CHARS, true)
      if (!slice) {
        return {
          ok: false,
          error: `no transcript on disk for "${key}" — the session may have been deleted since it was linked. List what is here with external_agent_sessions { action: "roster", providers: ["${provider}"] }.`,
        }
      }
      return { ok: true, language: 'markdown', content: digest(slice) }
    },
  }
}
