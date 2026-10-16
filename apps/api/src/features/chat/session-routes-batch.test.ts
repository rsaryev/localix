import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { isApiError } from '../../lib/errors'
import { routedParticipants, sessionFixture } from '../../testing/session-fixture'
import { createChatRepository } from './repository'
import { updateSessionRequestSchema } from './contracts/session'
import { assertRoutePatch, writeRoutePatch } from './service/session-route-patch'
import { reseatParticipants } from './service/participant-routes'
import { birthRoute } from './agent-route-resolution'

/** "Put the whole room on this model" — one batch write, all or nothing. */
describe('batch participant routes', () => {
  let db: ReturnType<typeof createDatabase>
  let repo: ReturnType<typeof createChatRepository>

  const room = () =>
    sessionFixture({
      agents: [
        ...routedParticipants({ agentId: 'lead', handle: 'lead', modelId: 'openai/strong' }),
        ...routedParticipants({ agentId: 'qa', handle: 'qa', modelId: 'openrouter/weak' }),
        ...routedParticipants({ agentId: 'fe', handle: 'fe', modelId: '' }),
      ],
    })

  beforeEach(async () => {
    db = createDatabase()
    await migrateToLatest(db)
    repo = createChatRepository(db)
  })

  afterEach(async () => {
    await destroyDatabase(db)
  })

  test('re-routes every named participant and stamps each as an explicit choice', async () => {
    const session = room()
    await repo.insertSession(session)
    const routes = ['lead', 'qa', 'fe'].map((agentId) => ({
      agentId,
      providerConnectionId: null,
      modelId: 'openai/strong',
      reasoningEffort: 'high' as const,
    }))
    await writeRoutePatch({ repo } as never, session.userId, session.id, session, { routes })

    const saved = (await repo.getSession(session.userId, session.id))!
    expect(
      saved.agents.map(({ agentId, modelId, reasoningEffort }) => [
        agentId,
        modelId,
        reasoningEffort,
      ]),
    ).toEqual([
      ['lead', 'openai/strong', 'high'],
      ['qa', 'openai/strong', 'high'],
      ['fe', 'openai/strong', 'high'],
    ])
    const stamps = await sql<{
      model_selected_at: string | null
      reasoning_selected_at: string | null
    }>`
      SELECT model_selected_at, reasoning_selected_at FROM conversation_participants
      WHERE session_id = ${session.id}`.execute(db)
    expect(stamps.rows.every((row) => row.model_selected_at && row.reasoning_selected_at)).toBe(
      true,
    )
  })

  test('a foreign owner moves nobody', async () => {
    const session = room()
    await repo.insertSession(session)
    await repo.updateSessionAgentRoutes('someone-else', session.id, [
      { agentId: 'lead', modelId: 'hijacked' },
    ])
    expect((await repo.getSession(session.userId, session.id))?.agents).toEqual(session.agents)
  })

  test('a batch naming an agent who could not take part is refused before anything is written', async () => {
    const failure = await assertRoutePatch({}, 'u', room(), {
      routes: [
        { agentId: 'lead', modelId: 'm' },
        { agentId: 'gone', modelId: 'm' },
      ],
    }).catch((error: unknown) => error)
    expect(isApiError(failure)).toBe(true)
    expect((failure as { code: string }).code).toBe('agent_unavailable')
  })

  test('a batch through a vanished connection is refused', async () => {
    const failure = await assertRoutePatch({ connectionExists: async () => false }, 'u', room(), {
      routes: [{ agentId: 'lead', providerConnectionId: 'gone', modelId: 'm' }],
    }).catch((error: unknown) => error)
    expect((failure as { code: string }).code).toBe('provider_connection_not_found')
  })

  test('one patch states one re-route, and names each participant once', async () => {
    const both = await assertRoutePatch({}, 'u', room(), {
      route: { agentId: 'lead', modelId: 'm' },
      routes: [{ agentId: 'qa', modelId: 'm' }],
    }).catch((error: unknown) => error)
    expect((both as { code: string }).code).toBe('route_conflict')
    const twice = await assertRoutePatch({}, 'u', room(), {
      routes: [
        { agentId: 'qa', modelId: 'm' },
        { agentId: 'qa', modelId: 'n' },
      ],
    }).catch((error: unknown) => error)
    expect((twice as { code: string }).code).toBe('route_duplicate_agent')
  })

  test('the wire schema requires an agent on every batch entry', () => {
    expect(updateSessionRequestSchema.safeParse({ routes: [{ modelId: 'm' }] }).success).toBe(false)
    expect(updateSessionRequestSchema.safeParse({ routes: [] }).success).toBe(false)
    expect(
      updateSessionRequestSchema.safeParse({
        routes: [{ agentId: 'qa', modelId: 'm', reasoningEffort: 'high' }],
      }).success,
    ).toBe(true)
  })

  test('an agent not invited yet can be given a model; it waits in the choice map', async () => {
    const session = room()
    await repo.insertSession(session)
    const resolve = async (_u: string, selection: { agentId?: string }) =>
      selection.agentId === 'later' ? { id: 'later', handle: 'later' } : null
    const patch = { routes: [{ agentId: 'later', modelId: 'm/later' }] }
    await assertRoutePatch({ resolveSessionAgent: resolve }, 'u', session, patch)
    await writeRoutePatch({ repo } as never, session.userId, session.id, session, patch)
    const saved = (await repo.getSession(session.userId, session.id))!
    expect(saved.agents).toEqual(session.agents)
    expect(saved.modelChoices?.agents.later?.modelId).toBe('m/later')
  })

  test('"All" is a cascade: every listed agent gets its own entry, a newcomer has none', async () => {
    const session = room()
    await repo.insertSession(session)
    const all = {
      providerConnectionId: null,
      modelId: 'openai/all',
      reasoningEffort: 'high' as const,
    }
    await writeRoutePatch({ repo } as never, session.userId, session.id, session, {
      routes: session.agents.map(({ agentId }) => ({ agentId, ...all })),
    })
    const current = (await repo.getSession(session.userId, session.id))!
    expect(Object.keys(current.modelChoices?.agents ?? {})).toEqual(['lead', 'qa', 'fe'])
    const seated = await reseatParticipants(
      { ...current, userId: session.userId },
      [...current.agents, { agentId: 'newcomer', handle: 'newcomer' }],
      async (_u, _p, _agentId, given) => birthRoute({ chosen: given?.chosen ?? null }),
    )
    expect(
      seated.map(({ agentId, modelId, reasoningEffort }) => [agentId, modelId, reasoningEffort]),
    ).toEqual([
      ['lead', 'openai/all', 'high'],
      ['qa', 'openai/all', 'high'],
      ['fe', 'openai/all', 'high'],
      ['newcomer', '', 'medium'],
    ])
  })

  test('the wire schema has no all-agents choice', () => {
    const parsed = updateSessionRequestSchema.safeParse({
      allAgents: { modelId: 'm', reasoningEffort: 'high' },
    })
    expect(parsed.success && 'allAgents' in parsed.data).toBe(false)
  })
})
