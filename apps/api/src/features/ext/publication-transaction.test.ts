import { afterEach, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createCapabilitySourceRepository } from '../capabilities/source-repository'
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
  const sources = createCapabilitySourceRepository(db, 'plugin')
  await sources.upsert('u', '', 'sample', { source: 'old-source' })
  const publish = (fail: boolean) =>
    publishExtensionTree({
      source,
      installRoot,
      name: 'sample',
      replace: true,
      commit: async () => {
        await db.transaction().execute(async (transaction) => {
          await createCapabilitySourceRepository(transaction, 'plugin').upsert('u', '', 'sample', {
            source: 'new-source',
          })
          if (fail) throw new Error('state transaction rejected')
        })
      },
    })
  return { sources, destination, installRoot, publish }
}

test('a rejected installation transaction restores files and source metadata', async () => {
  const f = await fixture()
  const previousSource = await f.sources.get('u', '', 'sample')
  await expect(f.publish(true)).rejects.toThrow('state transaction rejected')
  expect(await fs.readFile(join(f.destination, 'version.txt'), 'utf8')).toBe('old')
  expect(await f.sources.get('u', '', 'sample')).toEqual(previousSource)
  expect(await fs.readdir(f.installRoot)).toEqual(['sample'])
})

test('successful state commit publishes the files and the source metadata', async () => {
  const f = await fixture()
  await f.publish(false)
  expect(await fs.readFile(join(f.destination, 'version.txt'), 'utf8')).toBe('new')
  expect((await f.sources.get('u', '', 'sample'))?.source).toBe('new-source')
  expect(await fs.readdir(f.installRoot)).toEqual(['sample'])
})
