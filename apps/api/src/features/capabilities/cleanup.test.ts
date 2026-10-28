import { describe, expect, test } from 'bun:test'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createCoreChangeFeed, recordCoreChanges } from '../changes/core-entities'
import { createMcpRepository } from '../mcp/repository'
import { createCapabilityCleanup } from './cleanup'
import { createCapabilityRuleRepository } from './rule-repository'
import { createCapabilitySourceRepository } from './source-repository'

async function setup() {
  const db = createDatabase()
  await migrateToLatest(db)
  const signOuts: string[] = []
  const unbound: string[] = []
  const forgotten: string[] = []
  const cleanup = createCapabilityCleanup({
    db,
    userId: 'u1',
    clearMcpSignIn: async (_u, id) => void signOuts.push(id),
    unbindVaultConsumer: async (_u, type, id) => (unbound.push(`${type}:${id}`), 1),
    forgetPluginSecrets: async (_u, name) => void forgotten.push(name),
  })
  const rules = createCapabilityRuleRepository(db)
  await rules.replace('u1', 'a1', [
    { action: 'plugin:acme-board', resource: '*', effect: 'allow' },
    { action: 'mcp:github', resource: '*', effect: 'allow' },
    { action: 'mcp:github/create_issue', resource: '*', effect: 'deny' },
    { action: 'mcp:github', resource: 'repo:x', effect: 'ask' },
    { action: 'mcp:gitlab', resource: '*', effect: 'allow' },
  ])
  return { db, cleanup, rules, signOuts, unbound, forgotten }
}

describe('capability cleanup', () => {
  test('a removed MCP server takes its switches and its sign-in; a duplicate is harmless', async () => {
    const t = await setup()
    const feed = createCoreChangeFeed(t.db)
    await feed.subscribe('capability-cleanup', t.cleanup.handlers, { kind: 'reactor' })
    const mcp = createMcpRepository(t.db)
    await t.db
      .insertInto('capability_source')
      .values({
        id: 'srv1',
        user_id: 'u1',
        kind: 'mcp',
        name: 'github',
        created_at: 'x',
        updated_at: 'x',
      })
      .execute()
    const server = { id: 'srv1' }
    await mcp.delete('u1', server.id)
    await feed.settle()
    await t.cleanup.removed('mcp', 'github', server.id)
    expect((await t.rules.read('u1', 'a1')).map((r) => `${r.action} ${r.resource}`)).toEqual([
      'plugin:acme-board *',
      // The person's own rule about particular arguments stays.
      'mcp:github repo:x',
      'mcp:gitlab *',
    ])
    expect(t.signOuts).toEqual([server.id, server.id])
    await feed.close()
  })

  test('a plugin removed from one scope but installed in another keeps everything', async () => {
    const t = await setup()
    const plugins = createCapabilitySourceRepository(t.db, 'plugin')
    await plugins.upsert('u1', '', 'acme-board', { source: 'local' })
    await plugins.upsert('u1', 'p1', 'acme-board', { source: 'local' })
    const feed = createCoreChangeFeed(t.db)
    await feed.subscribe('capability-cleanup', t.cleanup.handlers, { kind: 'reactor' })
    await plugins.remove('u1', 'p1', 'acme-board')
    await feed.settle()
    expect(t.unbound).toEqual([])
    expect(t.forgotten).toEqual([])
    await plugins.remove('u1', '', 'acme-board')
    await feed.settle()
    expect(t.unbound).toEqual(['plugin:acme-board'])
    // The vault items holding its sensitive options go with the last copy.
    expect(t.forgotten).toEqual(['acme-board'])
    expect((await t.rules.read('u1', 'a1')).some((r) => r.action === 'plugin:acme-board')).toBe(
      false,
    )
    await feed.close()
  })

  describe('an agent that is gone', () => {
    const bind = (t: Awaited<ReturnType<typeof setup>>, id: string) =>
      createCapabilitySourceRepository(t.db, 'agent').upsert('u1', '', id, { source: 'user' })
    async function agents() {
      const t = await setup()
      await t.rules.replace('u1', 'cc:gone', [
        { action: 'tool:Bash', resource: '*', effect: 'allow' },
      ])
      await t.rules.replace('u1', 'cc:kept', [
        { action: 'agent:cc:gone', resource: '*', effect: 'allow' },
        { action: 'invocation:delegation', resource: 'cc:gone', effect: 'allow' },
        { action: 'invocation:delegation', resource: 'cc:other', effect: 'allow' },
        { action: 'tool:Bash', resource: '*', effect: 'ask' },
      ])
      const feed = createCoreChangeFeed(t.db)
      await feed.subscribe('capability-cleanup', t.cleanup.handlers, { kind: 'reactor' })
      return { t, feed }
    }
    const ref = (agentId: string) => ({ id: 'gone', scope: 'global', agentId })
    const actions = async (t: Awaited<ReturnType<typeof setup>>, id: string) =>
      (await t.rules.read('u1', id)).map((r) => `${r.action} ${r.resource}`)

    test('a purge empties its list and strips what other lists say about it; a duplicate is harmless', async () => {
      const { t, feed } = await agents()
      const purge = [{ entity: 'agent' as const, op: 'deleted' as const, ref: ref('cc:gone') }]
      await recordCoreChanges(t.db, purge)
      await recordCoreChanges(t.db, purge)
      await feed.settle()
      expect(await actions(t, 'cc:gone')).toEqual([])
      expect(await actions(t, 'cc:kept')).toEqual(['invocation:delegation cc:other', 'tool:Bash *'])
      expect(
        await t.db
          .selectFrom('capability_policy_revision')
          .selectAll()
          .where('agent_id', '=', 'cc:gone')
          .execute(),
      ).toEqual([])
      await feed.close()
    })

    test('a rename (old key deleted, same id still bound) keeps everything', async () => {
      const { t, feed } = await agents()
      await bind(t, 'cc:gone')
      await recordCoreChanges(t.db, [{ entity: 'agent', op: 'deleted', ref: ref('cc:gone') }])
      await feed.settle()
      expect(await actions(t, 'cc:gone')).toEqual(['tool:Bash *'])
      expect((await actions(t, 'cc:kept')).length).toBe(4)
      await feed.close()
    })

    test('a resync drops the lists of ids with no row, never a built-in or a bound agent', async () => {
      const { t, feed } = await agents()
      await bind(t, 'cc:kept')
      await t.rules.replace('u1', 'builtin:localix', [
        { action: 'tool:Bash', resource: '*', effect: 'allow' },
      ])
      await t.rules.replace('u1', 'native:old', [
        { action: 'tool:Bash', resource: '*', effect: 'allow' },
      ])
      await recordCoreChanges(t.db, [{ entity: 'agent', op: 'resync' }])
      await feed.settle()
      expect(await actions(t, 'cc:gone')).toEqual([])
      expect(await actions(t, 'native:old')).toEqual([])
      expect(await actions(t, 'builtin:localix')).toEqual(['tool:Bash *'])
      // The survivor loses what it said about the id that is gone.
      expect(await actions(t, 'cc:kept')).toEqual(['invocation:delegation cc:other', 'tool:Bash *'])
      await feed.close()
    })
  })
})
