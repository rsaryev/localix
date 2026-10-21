import { capabilityStores } from '../../bootstrap/capability-stores'
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'kysely'
import { Hono } from 'hono'
import type { AppContext } from '../../app'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createContributionKindRegistry } from '../ext/contribution-kinds'
import { createContributionStore } from '../ext/contribution-store'
import { createCapabilitySourceRepository } from '../capabilities/source-repository'
import { createAvailabilityWriter } from '../capabilities/availability'
import { createCapabilityRuleRepository } from '../capabilities/rule-repository'
import { resolveCapabilities } from '../capabilities/resolve'
import { agentContributionSchema } from './contribution'
import { createAgentsService } from './service'
import { createRegistrationPolicyService } from './registration-policy'
import type { Rule } from '../agent-core/capability-rule'
import { createAgentsRoutes } from './routes'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const run of cleanup.splice(0).reverse()) await run()
})
const proposals: Rule[] = [
  { action: 'tool:*', resource: '*', effect: 'deny' },
  { action: 'tool:read', resource: '*', effect: 'allow', message: '' },
]
const item = (instructions = 'Review.') => ({
  kind: 'agent',
  key: 'reviewer',
  value: {
    definition: { handle: 'reviewer', instructions },
    policyProposals: proposals,
  },
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'localix-policy-binding-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const db = createDatabase()
  cleanup.push(() => db.destroy())
  await migrateToLatest(db)
  const sources = createCapabilitySourceRepository(db, 'plugin')
  const source = await sources.upsert('u', '', 'review-pack', {})
  const kinds = createContributionKindRegistry()
  kinds.register('agent', agentContributionSchema)
  const store = createContributionStore(db, kinds)
  const publication = await store.publish('u', source.id, 0, [item()])
  const id = publication.contributions[0]!.id
  const agents = createAgentsService({ db, capabilityStores, globalDir: root })
  const policy = agents.registrationPolicy
  const rules = createCapabilityRuleRepository(db)
  const input = { expectedRegistrationRevision: 1, expectedPolicyRevision: 0, rules: proposals }
  const enable = async () => {
    const writer = createAvailabilityWriter(db)
    // Both switches live in the registered agent's OWN list: whether its source plugin may
    // run, and whether the agent itself may be invoked, are both statements about this agent.
    await writer.set('u', id, 'plugin', [{ name: 'review-pack', enabled: true }])
    await writer.set('u', id, 'agent', [{ name: id, enabled: true }])
  }
  return { db, sources, source, store, id, agents, policy, rules, input, enable }
}

test('review is inert; explicit publication binds a complete agent policy without enabling its source', async () => {
  const { id, policy, rules, agents, input, enable } = await fixture()
  expect(await policy.review('u', '', id)).toEqual({
    agentId: id,
    projectId: '',
    sourceName: 'review-pack',
    registrationRevision: 1,
    policyRevision: 0,
    currentRules: [],
    proposedRules: proposals,
  })
  expect(await rules.read('u', id)).toEqual([])
  // Switching the source and the agent on is an ordinary policy write into the SAME list the
  // review binds, so it comes first: a write after publication invalidates the binding, which
  // is exactly what the binding is for.
  await enable()
  expect(await agents.resolveEnabledAgent('u', id)).toBeNull()
  await policy.publish('u', '', id, { ...input, expectedPolicyRevision: 2 })
  expect(await agents.resolveEnabledAgent('u', id)).toMatchObject({ id, handle: 'reviewer' })
  const effective = await resolveCapabilities(rules, { userId: 'u', agentId: id })
  expect(effective.verdict('tool', 'read').effect).toBe('allow')
  expect(effective.verdict('tool', 'bash').effect).toBe('deny')
})

test('policy review locates an owned project registration without changing invocation scope', async () => {
  const { policy, sources, store, agents } = await fixture()
  const source = await sources.upsert('u', 'p', 'review-pack', {})
  const published = await store.publish('u', source.id, 0, [item()])
  const id = published.contributions[0]!.id
  expect(await policy.reviewIfRegistered('u', id)).toMatchObject({
    agentId: id,
    projectId: 'p',
    sourceName: 'review-pack',
  })
  expect(await policy.reviewIfRegistered('other', id)).toBeNull()
  expect(await policy.reviewIfRegistered('u', 'builtin:lead')).toBeNull()
  expect(await agents.resolveEnabledAgent('u', id)).toBeNull()
  await sources.remove('u', 'p', 'review-pack')
  expect(await policy.reviewIfRegistered('u', id)).toBeNull()
})

test('an identical retry is idempotent, including empty rule messages', async () => {
  const { id, policy, rules, input } = await fixture()
  const first = await policy.publish('u', '', id, input)
  expect(await policy.publish('u', '', id, input)).toEqual(first)
  expect((await rules.readSnapshot('u', id)).revision).toBe(1)
})

test('a retry retains existing enabled choices without duplicating switches', async () => {
  const { id, policy, rules, input, enable } = await fixture()
  await enable()
  const reviewed = { ...input, expectedPolicyRevision: 2 }
  const first = await policy.publish('u', '', id, reviewed)
  expect(await policy.publish('u', '', id, reviewed)).toEqual(first)
  const snapshot = await rules.readSnapshot('u', id)
  expect(snapshot.revision).toBe(3)
  expect(snapshot.rules.filter((rule) => rule.action === `agent:${id}`)).toHaveLength(1)
  expect(snapshot.rules.filter((rule) => rule.action === 'plugin:review-pack')).toHaveLength(1)
})

test('sibling publication preserves review; changing and restoring the agent requires a new review', async () => {
  const { source, store, policy, input, id, agents, enable } = await fixture()
  // Enable first: a policy write after publication invalidates the binding by design, and
  // switching the agent on IS such a write now that its switch lives in the same list.
  await enable()
  await policy.publish('u', '', id, { ...input, expectedPolicyRevision: 2 })
  const sibling = {
    kind: 'agent',
    key: 'helper',
    value: {
      definition: { handle: 'helper', instructions: 'Help.' },
      policyProposals: [],
    },
  }
  await store.publish('u', source.id, 1, [sibling, item()])
  expect(await agents.resolveEnabledAgent('u', id)).toMatchObject({ id })
  expect((await policy.review('u', '', id)).registrationRevision).toBe(1)
  await store.publish('u', source.id, 2, [item(), sibling])
  expect(await agents.resolveEnabledAgent('u', id)).toMatchObject({ id })
  await store.publish('u', source.id, 3, [item('Changed.'), sibling])
  expect(await agents.resolveEnabledAgent('u', id)).toBeNull()
  await store.publish('u', source.id, 4, [item(), sibling])
  expect(await agents.resolveEnabledAgent('u', id)).toBeNull()
  expect((await policy.review('u', '', id)).registrationRevision).toBe(5)
})

test('an updated registration invalidates review and rejects stale publication without changing policy', async () => {
  const { id, policy, rules, input, agents, enable, store, source } = await fixture()
  // Enable first: a policy write after publication invalidates the binding by design, and
  // switching the agent on IS such a write now that its switch lives in the same list.
  await enable()
  await policy.publish('u', '', id, { ...input, expectedPolicyRevision: 2 })
  await store.publish('u', source.id, 1, [item('Updated review.')])
  expect((await agents.getAgent('u', id))?.unavailableReason).toBe('policy_pending')
  expect(await agents.resolveEnabledAgent('u', id)).toBeNull()
  await expect(policy.publish('u', '', id, input)).rejects.toThrow('registered agent changed')
  expect((await rules.readSnapshot('u', id)).revision).toBe(3)
  await policy.publish('u', '', id, {
    ...input,
    expectedRegistrationRevision: 2,
    expectedPolicyRevision: 3,
  })
  expect(await agents.resolveEnabledAgent('u', id)).toMatchObject({
    instructions: 'Updated review.',
  })
})

test('a later ordinary policy write invalidates the bound review and cannot reuse a stale acceptance', async () => {
  const { id, policy, rules, input, agents, enable } = await fixture()
  // Enable first: a policy write after publication invalidates the binding by design, and
  // switching the agent on IS such a write now that its switch lives in the same list.
  await enable()
  await policy.publish('u', '', id, { ...input, expectedPolicyRevision: 2 })
  await rules.publish('u', id, [], 3)
  expect(await agents.resolveEnabledAgent('u', id)).toBeNull()
  await expect(policy.publish('u', '', id, input)).rejects.toThrow('Policy changed')
  expect(await rules.read('u', id)).toEqual([])
})

test('review and publication require an exact live identity, owner and project', async () => {
  const { id, policy, input, sources, enable, agents } = await fixture()
  await expect(policy.review('other', '', id)).rejects.toThrow('not found')
  await expect(policy.publish('u', 'other-project', id, input)).rejects.toThrow('not found')
  await expect(policy.review('u', '', 'reviewer')).rejects.toThrow('not found')
  // Enable first: a policy write after publication invalidates the binding by design, and
  // switching the agent on IS such a write now that its switch lives in the same list.
  await enable()
  await policy.publish('u', '', id, { ...input, expectedPolicyRevision: 2 })
  await sources.remove('u', '', 'review-pack')
  expect(await agents.resolveEnabledAgent('u', id)).toBeNull()
  await expect(policy.publish('u', '', id, input)).rejects.toThrow('not found')
})

test('a binding write failure rolls back both rules and their revision', async () => {
  const { db, id, policy, rules, input } = await fixture()
  await sql`CREATE TRIGGER fail_test_binding BEFORE INSERT ON capability_policy_binding
    BEGIN SELECT RAISE(ABORT, 'injected failure'); END`.execute(db)
  await expect(policy.publish('u', '', id, input)).rejects.toThrow('injected failure')
  expect(await rules.readSnapshot('u', id)).toEqual({ revision: 0, rules: [] })
  expect(await db.selectFrom('capability_policy_binding').selectAll().execute()).toEqual([])
})

test('two different publications cannot both approve the same policy revision', async () => {
  const { id, policy, rules, input } = await fixture()
  const results = await Promise.allSettled([
    policy.publish('u', '', id, input),
    policy.publish('u', '', id, { ...input, rules: [] }),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  expect((await rules.readSnapshot('u', id)).revision).toBe(1)
})

test('installation failure rolls back the policy and its review binding together', async () => {
  const { db, id, rules, input } = await fixture()
  await expect(
    db.transaction().execute(async (transaction) => {
      await createRegistrationPolicyService(transaction, capabilityStores).publish(
        'u',
        '',
        id,
        input,
      )
      throw new Error('installation failed')
    }),
  ).rejects.toThrow('installation failed')
  expect(await rules.readSnapshot('u', id)).toEqual({ revision: 0, rules: [] })
  expect(await db.selectFrom('capability_policy_binding').selectAll().execute()).toEqual([])
})

test('the policy review endpoint requires both revisions and never accepts a stale replacement', async () => {
  const { id, input, agents } = await fixture()
  const routes = new Hono<AppContext>()
    .use('*', async (c, next) => {
      c.set('userId', 'u')
      await next()
    })
    .route('/', createAgentsRoutes(agents))
  const path = `/${encodeURIComponent(id)}/policy-review`
  const review = await routes.request(path)
  expect(review.status).toBe(200)
  expect(await review.json()).toMatchObject({
    agentId: id,
    registrationRevision: 1,
    policyRevision: 0,
  })
  const put = (body: unknown) =>
    routes.request(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  expect((await put({ rules: proposals })).status).toBe(400)
  expect((await put(input)).status).toBe(200)
  expect((await put(input)).status).toBe(200)
  expect((await put({ ...input, rules: [] })).status).toBe(409)
})
