import { afterEach, expect, test } from 'bun:test'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { sql } from 'kysely'
import { Hono } from 'hono'
import type { AppContext } from '../../app'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createCapabilityRuleRepository } from './rule-repository'
import { createCapabilityRoutes } from './routes'
import { createAvailabilityWriter } from './availability'
import type { Rule } from '../agent-core/capability-rule'
import { seedAgentPresets } from './seed-agent-presets'
import { createCapabilitySourceRepository } from './source-repository'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.destroy()))
})
/** Rules are keyed by agent and by nothing else, so every case here names one. */
const AGENT = DEFAULT_AGENT_ID
const rule = (action: string): Rule => ({ action, resource: '*', effect: 'deny' })
async function fixture() {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  return { db, rules: createCapabilityRuleRepository(db), switches: createAvailabilityWriter(db) }
}

test('an empty scope has revision zero; clearing rules still advances the revision', async () => {
  const { rules } = await fixture()
  expect(await rules.readSnapshot('u', AGENT)).toEqual({ revision: 0, rules: [] })
  expect(await rules.publish('u', AGENT, [rule('tool:Read')], 0)).toBe(1)
  expect(await rules.publish('u', AGENT, [], 1)).toBe(2)
  await expect(rules.publish('u', AGENT, [rule('tool:Bash')], 0)).rejects.toThrow('Policy changed')
  expect(await rules.readSnapshot('u', AGENT)).toEqual({ revision: 2, rules: [] })
})

test('concurrent editors have one winner and cannot merge or overwrite their snapshots', async () => {
  const { rules } = await fixture()
  const results = await Promise.allSettled([
    rules.publish('u', AGENT, [rule('tool:Read')], 0),
    rules.publish('u', AGENT, [rule('tool:Bash')], 0),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  expect((await rules.readSnapshot('u', AGENT)).revision).toBe(1)
  expect(await rules.read('u', AGENT)).toHaveLength(1)
})

test('revisions are isolated by owner and exact policy scope', async () => {
  const { rules } = await fixture()
  await rules.publish('u', AGENT, [rule('tool:Read')], 0)
  expect(await rules.publish('u', 'agent-b', [], 0)).toBe(1)
  expect(await rules.publish('u', 'contribution:a', [], 0)).toBe(1)
  expect(await rules.readSnapshot('other', AGENT)).toEqual({ revision: 0, rules: [] })
  expect(await rules.readSnapshot('u', 'agent-unknown')).toEqual({ revision: 0, rules: [] })
})

test('switch mutations preserve concurrent changes and invalidate older editors', async () => {
  const { rules, switches } = await fixture()
  await Promise.all([
    switches.set('u', AGENT, 'tool', [{ name: 'Read', enabled: false }]),
    switches.set('u', AGENT, 'tool', [{ name: 'Bash', enabled: false }]),
  ])
  expect((await rules.read('u', AGENT)).map((entry) => entry.action).sort()).toEqual([
    'tool:Bash',
    'tool:Read',
  ])
  await expect(rules.publish('u', AGENT, [], 0)).rejects.toThrow('Policy changed')
  await rules.replace('u', AGENT, [rule('tool:Write')])
  expect((await rules.readSnapshot('u', AGENT)).revision).toBe(3)
})

test('failed rule insertion rolls back the revision and previous rules together', async () => {
  const { db, rules } = await fixture()
  await rules.publish('u', AGENT, [rule('tool:Read')], 0)
  await sql`CREATE TRIGGER fail_test_policy BEFORE INSERT ON capability_rule
    WHEN NEW.action = 'explode' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`.execute(db)
  await expect(rules.publish('u', AGENT, [rule('tool:Bash'), rule('explode')], 1)).rejects.toThrow(
    'injected failure',
  )
  expect(await rules.readSnapshot('u', AGENT)).toEqual({
    revision: 1,
    rules: [rule('tool:Read')],
  })
})

test('policy publication participates in the installation transaction', async () => {
  const { db, rules } = await fixture()
  await expect(
    db.transaction().execute(async (transaction) => {
      await createCapabilityRuleRepository(transaction).publish('u', AGENT, [rule('tool:Read')], 0)
      throw new Error('installation failed')
    }),
  ).rejects.toThrow('installation failed')
  expect(await rules.readSnapshot('u', AGENT)).toEqual({ revision: 0, rules: [] })
})

test('concurrent preset seeds publish once and never refill a deliberately empty policy', async () => {
  const { db, rules } = await fixture()
  const ports = {
    rules,
    sources: createCapabilitySourceRepository(db, 'agent'),
    listAgents: async () => [{ id: 'builtin:localix', name: 'localix' }],
  }
  const outcomes = await Promise.all([seedAgentPresets(ports, 'u'), seedAgentPresets(ports, 'u')])
  expect(outcomes.flat()).toEqual(['builtin:localix'])
  expect((await rules.readSnapshot('u', 'builtin:localix')).revision).toBe(1)
  await rules.publish('other', 'builtin:localix', [], 0)
  expect(await seedAgentPresets(ports, 'other')).toEqual([])
  expect(await rules.readSnapshot('other', 'builtin:localix')).toEqual({ revision: 1, rules: [] })
})

test('the HTTP editor requires the loaded revision and reports stale saves as conflicts', async () => {
  const { rules } = await fixture()
  const routes = new Hono<AppContext>()
    .use('*', async (c, next) => {
      c.set('userId', 'u')
      await next()
    })
    .route(
      '/',
      createCapabilityRoutes({
        getSnapshot: async () => {
          throw new Error('unused')
        },
        applyRules: async () => {
          throw new Error('unused')
        },
        readRules: async (user, target) => ({
          scope: target.agentId ?? AGENT,
          ...(await rules.readSnapshot(user, target.agentId ?? AGENT)),
        }),
        writeRules: async (user, target, values, expected) => ({
          scope: target.agentId ?? AGENT,
          revision: await rules.publish(user, target.agentId ?? AGENT, values, expected),
        }),
      }),
    )
  const put = (body: unknown) =>
    routes.request('/rules', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  expect(await (await routes.request('/rules')).json()).toEqual({
    scope: AGENT,
    rules: [],
    revision: 0,
  })
  expect((await put({ rules: [] })).status).toBe(400)
  expect((await put({ rules: [rule('tool:Read')], expectedRevision: 0 })).status).toBe(200)
  expect((await put({ rules: [], expectedRevision: 0 })).status).toBe(409)
  expect((await rules.readSnapshot('u', AGENT)).revision).toBe(1)
})
