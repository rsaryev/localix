import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { symlinkSync } from 'node:fs'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { MOD_LIMITS } from '../../plugins/kit'
import { diskModFs, fileModStore, sessionModEnv } from './platform-ports'

const scratch = tempDirPerTest('mods-platform-ports', {})
const signal = new AbortController().signal

test('the disk port reads, lists and stats with the user’s own view, absence as undefined', async () => {
  const dir = scratch()
  writeTree(dir, { 'a.txt': 'hi', 'sub/b.txt': 'x' })
  symlinkSync(join(dir, 'a.txt'), join(dir, 'link'))
  expect(await diskModFs.read(join(dir, 'a.txt'), signal, 'bytes')).toEqual({
    text: 'hi',
    bytes: 2,
    base64: 'aGk=',
  })
  expect(await diskModFs.read(join(dir, 'none'), signal)).toBeUndefined()
  const names = (await diskModFs.list(dir, signal))?.map((entry) => [entry.name, entry.kind])
  expect(names?.sort()).toEqual([
    ['a.txt', 'file'],
    ['link', 'file'],
    ['sub', 'dir'],
  ])
  const stat = await diskModFs.stat(join(dir, 'link'), signal, { resolve: true })
  expect(stat?.isLink).toBe(true)
  expect(stat?.realPath?.endsWith('a.txt')).toBe(true)
  expect((await diskModFs.ancestors(join(dir, 'a.txt'), signal))[0]).toBe(dir)
})

test('each mod’s store is one JSON file in its data folder, capped', async () => {
  const dir = scratch()
  const store = fileModStore((plugin) => join(dir, plugin))
  expect(await store.read('m')).toEqual({})
  await store.write('m', { n: 1 })
  expect(await store.read('m')).toEqual({ n: 1 })
  await expect(store.write('m', { big: 'x'.repeat(MOD_LIMITS.fileBytes) })).rejects.toThrow(/over/)
})

test('the environment a mod sets is the session’s own; undefined unsets', () => {
  const env = sessionModEnv({ A: '1' })
  env.set('B', '2')
  env.set('A', undefined)
  expect(env.snapshot()).toEqual({ B: '2' })
})
