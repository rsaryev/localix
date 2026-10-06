import { Hono } from 'hono'
import { zValidator } from '../../../lib/validator'
import { jsonError } from '../../../lib/http'
import type { HostRouteContext } from '@localixai/plugin-sdk/backend'
import type { AgentSessionsService } from './service'
import { toTranscriptTurns } from './transcript/to-agent-items'
import { itemsBodySchema, rosterBodySchema, statsBodySchema } from './route-schemas'
import { resumeSession } from './resume-session'
import { installedExternalAgents, type InstalledExternalAgent } from '../installed'
import { parseLinkKey } from '../shared/identity'
import type { RosterRow } from '../shared/contracts'
import { computeStats } from './discovery/stats'

const detail = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Core RPC: installed CLIs, a bounded history page, and the native transcript projection. */
export function createAgentSessionsRoutes(
  service: AgentSessionsService | undefined,
  installed: () => Promise<InstalledExternalAgent[]> = installedExternalAgents,
) {
  return new Hono<HostRouteContext>()
    .get('/providers', async (c) => {
      try {
        return c.json({ providers: await installed() })
      } catch (error) {
        return jsonError(
          c,
          500,
          'agent_detection_failed',
          'Could not check installed agents.',
          detail(error),
        )
      }
    })
    .post('/roster', zValidator('json', rosterBodySchema), async (c) => {
      if (!service)
        return jsonError(c, 503, 'history_unavailable', 'External agent history is unavailable.')
      try {
        const input = c.req.valid('json')
        const available = await installed()
        const requested = input.query?.providers
        const providers = available
          .map((agent) => agent.id)
          .filter((id) => !requested?.length || requested.includes(id))
        // An empty provider filter means "all" to the index. Never forward it after a miss.
        if (!providers.length) {
          return c.json({ items: [] as Omit<RosterRow, 'usage'>[], total: 0, withheld: 0 })
        }
        const rows = await service.roster({ ...input.query, providers }, input.localixSessionId)
        return c.json({ ...rows, items: rows.items.map(({ usage: _usage, ...row }) => row) })
      } catch (error) {
        return jsonError(
          c,
          500,
          'history_read_failed',
          'Could not read external agent history.',
          detail(error),
        )
      }
    })
    .post('/items', zValidator('json', itemsBodySchema), async (c) => {
      if (!service)
        return jsonError(c, 503, 'history_unavailable', 'External agent history is unavailable.')
      const { key, maxEvents, tail } = c.req.valid('json')
      try {
        const identity = parseLinkKey(key)
        const available = await installed()
        if (!identity || !available.some((agent) => agent.id === identity.provider)) {
          return jsonError(c, 404, 'agent_not_installed', 'This agent is not installed.')
        }
        const slice = await service.transcript(key, maxEvents, undefined, tail)
        if (!slice)
          return jsonError(c, 404, 'transcript_not_found', 'This session is no longer on disk.')
        return c.json({
          key: slice.key,
          turns: toTranscriptTurns(slice.events, slice.key),
          withheld: slice.withheld,
          total: slice.total,
          resume: resumeSession(slice.summary),
          ...(slice.sourceTruncated ? { sourceTruncated: true } : {}),
        })
      } catch (error) {
        return jsonError(
          c,
          500,
          'transcript_read_failed',
          'Could not read this agent session.',
          detail(error),
        )
      }
    })
    .post('/stats', zValidator('json', statsBodySchema), async (c) => {
      if (!service)
        return jsonError(c, 503, 'history_unavailable', 'External agent history is unavailable.')
      try {
        const input = c.req.valid('json')
        const available = await installed()
        const providers = available
          .map((agent) => agent.id)
          .filter((id) => !input.providers?.length || input.providers.includes(id))
        return c.json(
          providers.length
            ? await service.stats({ ...input, providers })
            : computeStats([], input, Date.now()),
        )
      } catch (error) {
        return jsonError(
          c,
          500,
          'history_summary_failed',
          'Could not summarize external agent history.',
          detail(error),
        )
      }
    })
}
