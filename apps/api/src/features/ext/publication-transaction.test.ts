import { afterEach, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createCapabilitySourceRepository } from '../capabilities/source-repository'
import { createContributionKindRegistry } from './contribution-kinds'
import { createContributionStore } from './contribution-store'
import { publishExtensionTree } from './publish-tree'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

async function fixture() {
  const db = createDatabase()
  cleanup.push(() => db.destroy())
  await migrateToLatest(db)
  const root = await fs.mkdtemp(join(tmpdir(), 'localix-publication-transaction-'))
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const installRoot = join(root, 'installed')
  const destination = join(installRoot, 'sample')
  await fs.mkdir(source)
  await fs.mkdir(destination, { recursive: true })
  await fs.writeFile(join(source, 'version.txt'), 'new')
  await fs.writeFile(join(destination, 'version.txt'), 'old')
  const kinds = createContributionKindRegistry()
  kinds.register('fixture', z.strictObject({ version: z.string() }))
  const sources = createCapabilitySourceRepository(db, 'plugin')
  const registration = await sources.upsert('u', '', 'sample', { source: 'old-source' })
  const store = createContributionStore(db, kinds)
  const item = (version: string) => [{ kind: 'fixture', key: 'sample', value: { version } }]
  const previous = await store.publish('u', registration.id, 0, item('old'))
  const publish = (fail: boolean, expectedRevision = 1) =>
    publishExtensionTree({
      source,
      installRoot,
      name: 'sample',
      replace: true,
      commit: async (directory) => {
        await db.transaction().execute(async (transaction) => {
          await createCapabilitySourceRepository(transaction, 'plugin').upsert('u', '', 'sample', {
            source: 'new-source',
          })
          await createContributionStore(transaction, kinds).publish(
            'u',
            registration.id,
            expectedRevision,
            item(await fs.readFile(join(directory, 'version.txt'), 'utf8')),
          )
          if (fail) throw new Error('state transaction rejected')
        })
      },
    })
  return { db, store, sources, registration, previous, destination, installRoot, publish }
}

test('a rejected installation transaction restores files, source metadata and contributions', async () => {
  const f = await fixture()
  const previousSource = await f.sources.get('u', '', 'sample')
  await expect(f.publish(true)).rejects.toThrow('state transaction rejected')
  expect(await fs.readFile(join(f.destination, 'version.txt'), 'utf8')).toBe('old')
  expect(await f.store.getCurrent('u', f.registration.id)).toEqual(f.previous)
  expect(await f.sources.get('u', '', 'sample')).toEqual(previousSource)
  expect(await fs.readdir(f.installRoot)).toEqual(['sample'])
})

test('successful state commit publishes matching files and contributions with stable identity', async () => {
  const f = await fixture()
  await f.publish(false)
  expect(await fs.readFile(join(f.destination, 'version.txt'), 'utf8')).toBe('new')
  const current = await f.store.getCurrent('u', f.registration.id)
  expect(current?.revision).toBe(2)
  expect(current?.contributions[0]).toMatchObject({
    id: f.previous.contributions[0]!.id,
    value: { version: 'new' },
  })
  expect((await f.sources.get('u', '', 'sample'))?.source).toBe('new-source')
  expect(await fs.readdir(f.installRoot)).toEqual(['sample'])
})

test('a stale contribution revision restores the tree and rolls back preceding metadata writes', async () => {
  const f = await fixture()
  const previousSource = await f.sources.get('u', '', 'sample')
  await expect(f.publish(false, 0)).rejects.toMatchObject({ code: 'contribution_conflict' })
  expect(await fs.readFile(join(f.destination, 'version.txt'), 'utf8')).toBe('old')
  expect(await f.store.getCurrent('u', f.registration.id)).toEqual(f.previous)
  expect(await f.sources.get('u', '', 'sample')).toEqual(previousSource)
})
