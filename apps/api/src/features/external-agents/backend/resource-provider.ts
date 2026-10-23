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
 * `<provider>` is the ADAPTER id — the same half
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
} from '@localixai/mini-app-sdk/backend'
import {
  buildResourceUri,
  decodeResourceSegment,
  noticeNode,
  providerSegments,
} from '@localixai/mini-app-sdk/backend'
import type { ResourceRefScope } from '@localixai/mini-app-sdk/resource-refs'

import { PROVIDER_ADAPTERS, adapterFor } from './adapters/registry'
import { MAX_ROSTER_LIMIT } from '../shared/contracts'
import { isPendingKey } from './live/store'
import { linkKeyOf } from '../shared/identity'
import { digest, DIGEST_SCAN_EVENTS, DIGEST_SCAN_EVENT_CHARS } from './resource-digest'
import {
  PROVIDER,
  PROJECT_SEG,
  providerUri,
  projectUri,
  plural,
  matchesQuery,
  capped,
  sessionNode,
  projectNode,
} from './resource-nodes'
import type {
  Bounded,
  ProviderStatus,
  RosterQuery,
  RosterRow,
  TranscriptSlice,
} from '../shared/contracts'

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
