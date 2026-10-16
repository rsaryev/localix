import { afterEach, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'
import { z } from 'zod'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createCapabilitySourceRepository } from '../capabilities/source-repository'
import { agentContributionSchema } from '../agents/contribution'
import { decodeClaudeCodeAgent } from '../cc-settings/agent-format'
import { createContributionKindRegistry } from './contribution-kinds'
import { createContributionStore } from './contribution-store'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.destroy()))
})
async function fixture() {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  const sources = createCapabilitySourceRepository(db, 'plugin')
  const source = await sources.upsert('u', '', 'sample', { source: 'local' })
  const kinds = createContributionKindRegistry()
  kinds.register('agent', agentContributionSchema)
  kinds.register('fixture', z.strictObject({ label: z.string() }))
  const store = createContributionStore(db, kinds)
  return { db, sources, source, store, kinds }
}
const item = (key: string, label = key) => ({ kind: 'fixture', key, value: { label } })

describe('owned contribution publication', () => {
  test('source ordering and sibling updates retain unchanged payload revisions', async () => {
    const { source, store } = await fixture()
    const first = await store.publish('u', source.id, 0, [item('one')])
    const next = await store.publish('u', source.id, 1, [item('two'), item('one')])
    expect(next.revision).toBe(2)
    expect(next.contributions[1]).toEqual(first.contributions[0])
    const reordered = await store.publish('u', source.id, 2, [item('one'), item('two', 'updated')])
    expect(reordered.revision).toBe(3)
    expect(reordered.contributions[0]).toEqual(first.contributions[0])
    expect(reordered.contributions[1]?.revision).toBe(3)
    const changed = await store.publish('u', source.id, 3, [item('one', 'changed')])
    expect(changed.contributions[0]?.revision).toBe(4)
    const restored = await store.publish('u', source.id, 4, [item('one')])
    expect(restored.contributions[0]?.revision).toBe(5)
  })

  test('publication participates in an installation transaction and rolls back with it', async () => {
    const { db, source, store, kinds } = await fixture()
    await expect(
      db.transaction().execute(async (transaction) => {
        const staged = createContributionStore(transaction, kinds)
        await staged.publish('u', source.id, 0, [item('one')])
        expect((await staged.getCurrent('u', source.id))?.revision).toBe(1)
        throw new Error('installation failed')
      }),
    ).rejects.toThrow('installation failed')
    expect(await store.getCurrent('u', source.id)).toEqual({ revision: 0, contributions: [] })
  })

  test('updates retain identity and identical retries do not consume a revision', async () => {
    const { source, store } = await fixture()
    const first = await store.publish('u', source.id, 0, [item('one')])
    const retry = await store.publish('u', source.id, 0, [item('one')])
    expect(retry).toEqual(first)
    const updated = await store.publish('u', source.id, 1, [item('one', 'changed')])
    expect(updated.revision).toBe(2)
    expect(updated.contributions[0]?.id).toBe(first.contributions[0]?.id)
    expect(updated.contributions[0]?.value).toEqual({ label: 'changed' })
  })

  test('removal archives an identity and reintroduction gets a new one', async () => {
    const { source, store } = await fixture()
    const first = await store.publish('u', source.id, 0, [item('one')])
    const id = first.contributions[0]!.id
    await store.publish('u', source.id, 1, [])
    expect(await store.getHistory('u', id)).toMatchObject({
      archived: true,
      value: { label: 'one' },
    })
    const replacement = await store.publish('u', source.id, 2, [item('one')])
    expect(replacement.contributions[0]?.id).not.toBe(id)
    expect(await store.getHistory('other-user', id)).toBeNull()
  })

  test('uninstall archives contributions; a same-named reinstall cannot inherit them', async () => {
    const { source, sources, store } = await fixture()
    const first = await store.publish('u', source.id, 0, [item('one')])
    await sources.remove('u', '', 'sample')
    expect(await store.getCurrent('u', source.id)).toBeNull()
    expect(await store.getHistory('u', first.contributions[0]!.id)).toMatchObject({
      archived: true,
    })
    const reinstalled = await sources.upsert('u', '', 'sample', { source: 'local' })
    const next = await store.publish('u', reinstalled.id, 0, [item('one')])
    expect(reinstalled.id).not.toBe(source.id)
    expect(next.contributions[0]?.id).not.toBe(first.contributions[0]?.id)
  })

  test('scope follows the owning installation and foreign users cannot publish or read it', async () => {
    const { source, sources, store } = await fixture()
    const projectSource = await sources.upsert('u', 'p', 'sample', {})
    const global = await store.publish('u', source.id, 0, [item('one')])
    const project = await store.publish('u', projectSource.id, 0, [item('one')])
    expect(project.contributions[0]?.projectId).toBe('p')
    expect(global.contributions[0]?.projectId).toBe('')
    expect(project.contributions[0]?.id).not.toBe(global.contributions[0]?.id)
    await expect(store.publish('other', source.id, 1, [])).rejects.toThrow('not found')
    expect(await store.getCurrent('other', source.id)).toBeNull()
  })

  test('concurrent different publications have one winner, with no mixed snapshot', async () => {
    const { source, store } = await fixture()
    const results = await Promise.allSettled([
      store.publish('u', source.id, 0, [item('a')]),
      store.publish('u', source.id, 0, [item('b')]),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const snapshot = await store.getCurrent('u', source.id)
    expect(snapshot?.revision).toBe(1)
    expect(snapshot?.contributions).toHaveLength(1)
  })

  test('an invalid entry rejects the entire publication before writing', async () => {
    const { source, store } = await fixture()
    await expect(
      store.publish('u', source.id, 0, [
        item('valid'),
        { kind: 'fixture', key: 'invalid', value: { label: 42 } },
      ]),
    ).rejects.toThrow()
    await expect(store.publish('u', source.id, 0, [item('valid'), item('valid')])).rejects.toThrow(
      'Duplicate',
    )
    await expect(
      store.publish('u', source.id, 0, [{ ...item('unknown'), kind: 'unknown' }]),
    ).rejects.toThrow('Unregistered')
    expect(await store.getCurrent('u', source.id)).toEqual({ revision: 0, contributions: [] })
  })

  test('a storage failure rolls back the revision and every entry', async () => {
    const { db, source, store } = await fixture()
    const original = await store.publish('u', source.id, 0, [item('valid', 'original')])
    await sql`CREATE TRIGGER fail_test_contribution BEFORE INSERT ON extension_contribution
      WHEN NEW.contribution_key = 'explode' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`.execute(
      db,
    )
    await expect(
      store.publish('u', source.id, 1, [item('valid', 'changed'), item('explode')]),
    ).rejects.toThrow('injected failure')
    expect(await store.getCurrent('u', source.id)).toEqual(original)
    await sql`DROP TRIGGER fail_test_contribution`.execute(db)
    expect((await store.publish('u', source.id, 1, [item('valid', 'changed')])).revision).toBe(2)
  })

  test('a decoded agent stores native behavior and inert policy separately from registry metadata', async () => {
    const { db, source, store } = await fixture()
    const artifact = decodeClaudeCodeAgent(
      '---\nname: reviewer\ntools: [Read]\n---\nReview.',
      'agent.md',
    )
    if (artifact.status !== 'accepted') throw new Error('Expected accepted artifact')
    const snapshot = await store.publish('u', source.id, 0, [
      { kind: 'agent', key: 'reviewer', value: artifact.value },
    ])
    expect(snapshot.contributions[0]?.value).toEqual(artifact.value)
    expect(snapshot.contributions[0]?.id).toStartWith('contribution:')
    expect(
      await db.selectFrom('capability_rule').selectAll().where('user_id', '=', 'u').execute(),
    ).toEqual([])
  })
})
