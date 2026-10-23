import { expect, test } from 'bun:test'
import { createStateApi, createStateSpaces, STATE_VALUE_MAX_CHARS, whileDrawing } from './state-api'

function setup() {
  let redraws = 0
  const spaces = createStateSpaces({ changed: () => (redraws += 1) })
  const state = createStateApi({ plugin: 'p', space: '/work', spaces })
  return { spaces, state, redraws: () => redraws }
}

const COUNT = { plugin: 'p', key: 'count' }

test('a value unwritten reads undefined at version 0; each write is a new version', async () => {
  const { state } = setup()
  expect(await state.get(COUNT)).toEqual({ value: undefined, version: 0 })
  expect(await state.set(COUNT, 1)).toEqual({ isSet: true, version: 1 })
  expect(await state.set({ ...COUNT, value: { n: 2 } })).toEqual({ isSet: true, version: 2 })
  const held = await state.get(COUNT)
  expect(held).toEqual({ value: { n: 2 }, version: 2 })
  expect(Object.isFrozen(held.value)).toBe(true)
})

test('ifVersion writes only over the version it names', async () => {
  const { state } = setup()
  await state.set(COUNT, 1)
  expect(await state.set(COUNT, 5, { ifVersion: 0 })).toEqual({ isSet: false, version: 1 })
  expect(await state.set({ ...COUNT, value: 5, ifVersion: 1 })).toEqual({ isSet: true, version: 2 })
  await expect(state.set(COUNT, 5, { ifVersion: -1 })).rejects.toThrow('whole number')
})

test('a member of a family is its own value', async () => {
  const { state } = setup()
  await state.set({ ...COUNT, id: 'pane-a' }, 7)
  expect((await state.get(COUNT)).value).toBeUndefined()
  expect((await state.get({ ...COUNT, id: 'pane-a' })).value).toBe(7)
})

test('any mod reads a value; only the plugin it names writes it', async () => {
  const { spaces, state } = setup()
  const other = createStateApi({ plugin: 'q', space: '/work', spaces })
  await state.set(COUNT, 3)
  expect((await other.get(COUNT)).value).toBe(3)
  await expect(other.set(COUNT, 4)).rejects.toThrow('denied: p owns that value')
})

test('projects keep apart spaces', async () => {
  const { spaces, state } = setup()
  await state.set(COUNT, 3)
  const elsewhere = createStateApi({ plugin: 'p', space: '/other', spaces })
  expect((await elsewhere.get(COUNT)).value).toBeUndefined()
})

test('a reference and a value are checked', async () => {
  const { state } = setup()
  await expect(state.get({ plugin: 'p' })).rejects.toThrow('takes a reference { plugin, key }')
  await expect(state.get('count')).rejects.toThrow('takes a reference')
  await expect(state.set({ plugin: 'p', key: 'a\u0000b' }, 1)).rejects.toThrow('NUL')
  await expect(state.set(COUNT, undefined)).rejects.toThrow('never undefined')
  await expect(state.set(COUNT, { run: () => 1 })).rejects.toThrow('not JSON data: a function')
  await expect(state.set(COUNT, 'x'.repeat(STATE_VALUE_MAX_CHARS))).rejects.toThrow('limit')
})

test('a drawing that reads a value is drawn again when it is written, and may not write', async () => {
  const { state, redraws } = setup()
  await state.set({ plugin: 'p', key: 'other' }, 1)
  expect(redraws()).toBe(0)
  await whileDrawing('pane-1', async () => {
    await state.get(COUNT)
    await expect(state.set(COUNT, 1)).rejects.toThrow('drawing is pure')
  })
  await state.set({ plugin: 'p', key: 'other' }, 2)
  expect(redraws()).toBe(0)
  await state.set(COUNT, 1)
  expect(redraws()).toBe(1)
  // Drawn again without reading it, the pane no longer redraws on it.
  await whileDrawing('pane-1', async () => {
    await state.get({ plugin: 'p', key: 'other' })
  })
  await state.set(COUNT, 2)
  expect(redraws()).toBe(1)
})

test('a timer a drawing leaves behind writes once the drawing is done', async () => {
  const { state } = setup()
  let later: (() => Promise<unknown>) | undefined
  await whileDrawing('pane-1', async () => {
    later = () => state.set(COUNT, 9)
  })
  await expect(later!()).resolves.toEqual({ isSet: true, version: 1 })
})

test('a reset returns every value to its default, redraws, and never reuses a version', async () => {
  const { spaces, state, redraws } = setup()
  await state.set(COUNT, 1)
  await state.set(COUNT, 2)
  spaces.reset('/work')
  expect(redraws()).toBe(1)
  expect(await state.get(COUNT)).toEqual({ value: undefined, version: 0 })
  // A stale `ifVersion` from before the reset cannot match the new version.
  expect(await state.set(COUNT, 3)).toEqual({ isSet: true, version: 3 })
})

test('a space refuses a write past its total size; rewriting a key or a reset frees room', () => {
  const spaces = createStateSpaces({ changed: () => {}, maxSpaceChars: 10 })
  const ref = (id: string) => ({ plugin: 'p', key: 'k', id })
  spaces.set('/p', ref('a'), '"1234"')
  expect(() => spaces.set('/p', ref('b'), '"12345"')).toThrow('over the 10 limit')
  spaces.set('/p', ref('a'), '"1"')
  spaces.set('/p', ref('b'), '"12345"')
  spaces.reset('/p')
  spaces.set('/p', ref('c'), '"12345678"')
})
