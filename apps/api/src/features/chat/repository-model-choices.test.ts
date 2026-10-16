import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { routedParticipants, sessionFixture } from '../../testing/session-fixture'
import { createChatRepository } from './repository'
import { createRouteDefaults } from './service/session-route-defaults'

const tempDir = join(process.cwd(), 'tmp', 'chat-repository-model-choices-tests')
const USER = 'user-1'

async function seeded() {
  const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
  await migrateToLatest(db)
  const repo = createChatRepository(db)
  await repo.insertSession(
    sessionFixture({
      id: 's1',
      userId: USER,
      agents: routedParticipants({ agentId: 'a', handle: 'a', modelId: 'old/a' }),
    }),
  )
  return { db, repo }
}

describe('a session’s model choices', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })
  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('a fresh session has chosen nothing', async () => {
    const { db, repo } = await seeded()
    expect((await repo.getSession(USER, 's1'))?.modelChoices).toEqual({ agents: {} })
    await destroyDatabase(db)
  })

  test('the "All" cascade moves the seat and records every listed agent', async () => {
    const { db, repo } = await seeded()
    const route = { providerConnectionId: null, modelId: 'x/all', reasoningEffort: 'high' as const }
    await repo.updateSessionAgentRoutes(USER, 's1', [
      { agentId: 'a', ...route },
      { agentId: 'b', ...route },
    ])
    const session = await repo.getSession(USER, 's1')
    expect(session?.agents.map((seat) => seat.modelId)).toEqual(['x/all'])
    expect(session?.modelChoices).toEqual({ agents: { a: route, b: route } })
    await destroyDatabase(db)
  })

  test('a pick for one agent leaves the others alone', async () => {
    const { db, repo } = await seeded()
    const all = { providerConnectionId: null, modelId: 'x/all', reasoningEffort: 'high' as const }
    await repo.updateSessionAgentRoutes(USER, 's1', [
      { agentId: 'a', ...all },
      { agentId: 'b', ...all },
    ])
    await repo.updateSessionAgentRoutes(USER, 's1', [{ agentId: 'b', modelId: 'y/own' }])
    const session = await repo.getSession(USER, 's1')
    expect(session?.agents[0]?.modelId).toBe('x/all')
    expect(session?.modelChoices).toEqual({
      agents: {
        a: all,
        b: { providerConnectionId: null, modelId: 'y/own', reasoningEffort: 'high' },
      },
    })
    await destroyDatabase(db)
  })

  test('a level alone lands on the model the agent is on, and needs one', async () => {
    const { db, repo } = await seeded()
    await repo.updateSessionAgentRoutes(USER, 's1', [
      { agentId: 'a', reasoningEffort: 'max' },
      { agentId: 'nobody', reasoningEffort: 'max' },
    ])
    const session = await repo.getSession(USER, 's1')
    expect(session?.agents[0]?.reasoningEffort).toBe('max')
    expect(session?.modelChoices?.agents).toEqual({
      a: { providerConnectionId: null, modelId: 'old/a', reasoningEffort: 'max' },
    })
    await destroyDatabase(db)
  })

  test('every pick, seated or not, becomes that agent’s most recent model', async () => {
    const { db, repo } = await seeded()
    const haiku = {
      providerConnectionId: null,
      modelId: 'x/haiku',
      reasoningEffort: 'low' as const,
    }
    await repo.updateSessionAgentRoutes(USER, 's1', [
      { agentId: 'a', ...haiku },
      { agentId: 'b', ...haiku },
    ])
    const recent = await repo.listRecentRoutes(USER)
    expect(recent.byAgent.get('a')).toEqual(haiku)
    expect(recent.byAgent.get('b')).toEqual(haiku)
    // The stamps stay in storage; the summary does not carry them.
    expect('chosenAt' in ((await repo.getSession(USER, 's1'))?.modelChoices ?? {})).toBe(false)
    await destroyDatabase(db)
  })

  test('a new chat: each agent takes its card, else its last pick, else the project', async () => {
    const { db, repo } = await seeded()
    const haiku = {
      providerConnectionId: null,
      modelId: 'x/haiku',
      reasoningEffort: 'low' as const,
    }
    await repo.updateSessionAgentRoutes(USER, 's1', [
      { agentId: 'a', ...haiku },
      { agentId: 'carded', ...haiku },
    ])
    const defaults = createRouteDefaults({
      loadRecentRoutes: (userId) => repo.listRecentRoutes(userId),
      loadAgentModelDefaults: async () => new Map([['carded', { modelId: 'card/model' }]]),
      loadProjectModelDefaults: async () => ({ modelId: 'project/model' }),
    })
    expect(await defaults.seatRoute(USER, 'p', 'a')).toMatchObject({
      modelId: 'x/haiku',
      reasoningEffort: 'low',
      modelOrigin: 'recent',
    })
    expect(await defaults.seatRoute(USER, 'p', 'carded')).toMatchObject({
      modelId: 'card/model',
      modelOrigin: 'agent',
    })
    expect(await defaults.seatRoute(USER, 'p', 'never-picked')).toMatchObject({
      modelId: 'project/model',
      modelOrigin: 'project',
    })
    // The picker shows an agent not invited yet on exactly what it would join on.
    const join = await defaults.joinRoutes(USER, 'p')
    expect(join.agents.a).toEqual(haiku)
    expect(join.agents.carded?.modelId).toBe('card/model')
    expect(join.fallback?.modelId).toBe('project/model')
    await destroyDatabase(db)
  })

  test('another user’s session is not written', async () => {
    const { db, repo } = await seeded()
    await repo.updateSessionAgentRoutes('someone-else', 's1', [{ agentId: 'b', modelId: 'z' }])
    expect((await repo.getSession(USER, 's1'))?.modelChoices?.agents).toEqual({})
    await destroyDatabase(db)
  })
})
