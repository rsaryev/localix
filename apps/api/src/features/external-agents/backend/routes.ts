import { Hono } from 'hono'
import { routeValidator } from '@localixai/plugin-sdk/backend'
import type { HostRouteContext } from '@localixai/plugin-sdk/backend'
import type { AgentSessionsService } from './service'
import { toTranscriptTurns } from './transcript/to-agent-items'
import { itemsBodySchema, rosterBodySchema, statsBodySchema } from './route-schemas'
import { resumeSession } from './resume-session'
import { installedExternalAgents, type InstalledExternalAgent } from '../installed'
import { parseLinkKey } from '../shared/identity'
import type { RosterRow } from '../shared/contracts'
import { computeStats } from './discovery/stats'

const validated = routeValidator({ envelope: 'text' })

function failure(what: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error)
  return { error: what, ...(detail ? { detail } : {}) }
}

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
        return c.json(failure('Could not check installed agents.', error), 500)
      }
    })
    .post('/roster', validated('json', rosterBodySchema), async (c) => {
      if (!service) return c.json({ error: 'External agent history is unavailable.' }, 503)
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
        return c.json(failure('Could not read external agent history.', error), 500)
      }
    })
    .post('/items', validated('json', itemsBodySchema), async (c) => {
      if (!service) return c.json({ error: 'External agent history is unavailable.' }, 503)
      const { key, maxEvents, tail } = c.req.valid('json')
      try {
        const identity = parseLinkKey(key)
        const available = await installed()
        if (!identity || !available.some((agent) => agent.id === identity.provider)) {
          return c.json({ error: 'This agent is not installed.' }, 404)
        }
        const slice = await service.transcript(key, maxEvents, undefined, tail)
        if (!slice) return c.json({ error: 'This session is no longer on disk.' }, 404)
        return c.json({
          key: slice.key,
          turns: toTranscriptTurns(slice.events, slice.key),
          withheld: slice.withheld,
          total: slice.total,
          resume: resumeSession(slice.summary),
          ...(slice.sourceTruncated ? { sourceTruncated: true } : {}),
        })
      } catch (error) {
        return c.json(failure('Could not read this agent session.', error), 500)
      }
    })
    .post('/stats', validated('json', statsBodySchema), async (c) => {
      if (!service) return c.json({ error: 'External agent history is unavailable.' }, 503)
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
        return c.json(failure('Could not summarize external agent history.', error), 500)
      }
    })
}
