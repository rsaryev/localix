import { afterEach, expect, test } from 'bun:test'
import { z } from 'zod'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createCapabilitySourceRepository } from '../capabilities/source-repository'
import { createContributionKindRegistry } from './contribution-kinds'
import { createContributionReader } from './contribution-reader'
import { createContributionStore } from './contribution-store'

/** A typed payload for the tests' one contribution kind. */
const agentContributionSchema = z.object({
  definition: z.object({ handle: z.string(), instructions: z.string() }),
  policyProposals: z.array(z.unknown()).optional(),
})

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.destroy()))
})
const schema = z.strictObject({ label: z.string() })
const item = (key: string) => ({ kind: 'fixture', key, value: { label: key } })
async function fixture() {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  const sources = createCapabilitySourceRepository(db, 'plugin')
  const source = await sources.upsert('u', '', 'sample', {})
  const kinds = createContributionKindRegistry()
  kinds.register('fixture', schema)
  kinds.register('agent', agentContributionSchema)
  const store = createContributionStore(db, kinds)
  const reader = createContributionReader(db, 'fixture', schema)
  return { db, sources, source, store, reader }
}

test('readers resolve exact IDs and isolate users, projects and contribution kinds', async () => {
  const { sources, source, store, reader, db } = await fixture()
  const project = await sources.upsert('u', 'p', 'sample', {})
  const globalSet = await store.publish('u', source.id, 0, [item('same')])
  const projectSet = await store.publish('u', project.id, 0, [item('same')])
  const globalId = globalSet.contributions[0]!.id
  const projectId = projectSet.contributions[0]!.id
  expect(await reader.get('u', '', globalId)).toMatchObject({
    registration: {
      id: globalId,
      source: { id: source.id, kind: 'plugin', name: 'sample' },
      value: { label: 'same' },
    },
  })
  expect(await reader.get('other', '', globalId)).toBeNull()
  expect(await reader.get('u', 'p', globalId)).toBeNull()
  expect(await reader.get('u', '', 'same')).toBeNull()
  expect((await reader.list('u', 'p')).registrations.map((entry) => entry.id)).toEqual([projectId])
  expect(
    await createContributionReader(db, 'agent', agentContributionSchema).get('u', '', globalId),
  ).toBeNull()
})

test('archived and uninstalled IDs cannot become live through a matching key', async () => {
  const { source, sources, store, reader } = await fixture()
  const first = await store.publish('u', source.id, 0, [item('same')])
  const id = first.contributions[0]!.id
  await store.publish('u', source.id, 1, [])
  const replacement = await store.publish('u', source.id, 2, [item('same')])
  expect(await reader.get('u', '', id)).toBeNull()
  expect((await reader.list('u', '')).registrations[0]?.id).toBe(replacement.contributions[0]!.id)
  expect(await store.getHistory('u', id)).toMatchObject({ archived: true })
  await sources.remove('u', '', 'sample')
  expect(await reader.list('u', '')).toEqual({ registrations: [], errors: [] })
})

test('current schemas reject damaged and outdated records without hiding valid siblings', async () => {
  const { db, source, store, reader } = await fixture()
  const set = await store.publish('u', source.id, 0, [item('valid'), item('bad-json'), item('old')])
  const [valid, broken, outdated] = set.contributions
  await db
    .updateTable('extension_contribution')
    .set({ payload: '{secret' })
    .where('id', '=', broken!.id)
    .execute()
  await db
    .updateTable('extension_contribution')
    .set({ payload: '{"label":42}' })
    .where('id', '=', outdated!.id)
    .execute()
  const result = await reader.list('u', '')
  expect(result.registrations.map((entry) => entry.id)).toEqual([valid!.id])
  expect(result.errors).toEqual([
    { id: broken!.id, code: 'invalid_contribution' },
    { id: outdated!.id, code: 'invalid_contribution' },
  ])
  expect(await reader.get('u', '', broken!.id)).toEqual({ error: result.errors[0] })
  const newer = createContributionReader(db, 'fixture', schema.extend({ required: z.boolean() }))
  expect(await newer.get('u', '', valid!.id)).toEqual({
    error: { id: valid!.id, code: 'invalid_contribution' },
  })
})

test('a row cannot claim another installation owner or scope even if storage is corrupted', async () => {
  const { db, sources, source, store, reader } = await fixture()
  const foreign = await sources.upsert('other', '', 'foreign', {})
  const project = await sources.upsert('u', 'p', 'project', {})
  const set = await store.publish('u', source.id, 0, [item('user'), item('project')])
  await db
    .updateTable('extension_contribution')
    .set({ source_id: foreign.id })
    .where('id', '=', set.contributions[0]!.id)
    .execute()
  await db
    .updateTable('extension_contribution')
    .set({ source_id: project.id })
    .where('id', '=', set.contributions[1]!.id)
    .execute()
  expect(await reader.list('u', '')).toEqual({ registrations: [], errors: [] })
  expect(await reader.list('other', '')).toEqual({ registrations: [], errors: [] })
})
