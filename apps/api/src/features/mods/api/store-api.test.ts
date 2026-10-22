import { expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { createStoreApi } from './store-api'

const scratch = tempDirPerTest('mods-store', {})

test('every instance of a mod reads and writes one store', async () => {
  const dir = scratch()
  const projectA = createStoreApi(dir)
  const projectB = createStoreApi(dir)
  expect(await projectB.get('warm')).toBeUndefined()
  await projectA.set('a', 1)
  expect(await projectB.get('a')).toBe(1)
  await projectB.set('b', 2)
  expect(await projectA.get('a')).toBe(1)
  expect(await createStoreApi(dir).keys()).toEqual(['a', 'b'])
})

test('concurrent writes from two instances both land', async () => {
  const dir = scratch()
  const one = createStoreApi(dir)
  const two = createStoreApi(dir)
  await Promise.all([one.set('x', 1), two.set('y', 2), one.set({ key: 'z', value: 3 })])
  expect(await two.keys()).toEqual(['x', 'y', 'z'])
})

test('a store re-reads a file that changed beneath it', async () => {
  const dir = scratch()
  const store = createStoreApi(dir)
  await store.set('kept', true)
  rmSync(join(dir, 'mod-store.json'))
  expect(await store.get('kept')).toBeUndefined()
})

test('values are JSON data: a function, a symbol or a cycle is refused', async () => {
  const store = createStoreApi(scratch())
  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  await expect(store.set('fn', () => 1)).rejects.toThrow(/not JSON data/)
  await expect(store.set('nested', { run: () => 1 })).rejects.toThrow(/function is not JSON/)
  await expect(store.set('symbol', Symbol('s'))).rejects.toThrow(/not JSON data/)
  await expect(store.set('cycle', cycle)).rejects.toThrow(/store\.set/)
  await expect(store.set('missing', undefined)).rejects.toThrow(/not JSON data/)
  expect(await store.keys()).toEqual([])
})

test('get reads back the JSON form, and a copy a caller cannot change in place', async () => {
  const store = createStoreApi(scratch())
  await store.set('value', { at: new Date(0), gone: undefined, list: [1] })
  const read = (await store.get('value')) as { at: string; list: number[] }
  expect(read).toEqual({ at: '1970-01-01T00:00:00.000Z', list: [1] })
  read.list.push(2)
  expect(await store.get('value')).toEqual({ at: '1970-01-01T00:00:00.000Z', list: [1] })
})
