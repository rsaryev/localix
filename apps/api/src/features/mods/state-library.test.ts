import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { createStateApi, createStateSpaces } from './api/state-api'
import { bundleHooksModule } from './module-build'
import { runBundle } from './testing/testing-bundle'

const scratch = tempDirPerTest('mods-state-library', {})

/** A hooks module using every helper, as in Claude Code's "Keep a value in $.state". */
const MODULE = `
import { atom, derive, memberOf, read, update } from 'claude-code'
const count = atom({ plugin: 'hello-tabs', key: 'count' }, 0)
const tab = atom({ plugin: 'hello-tabs', key: 'tab' }, 'one', { shape: 2 })
const label = derive([count, tab], (n, t) => t + ':' + n)
const perPane = atom({ plugin: 'hello-tabs', key: 'scroll' }, 0)
export function register() {
  return {
    add: ($) => update($, count, (value) => value + 1),
    pick: ($, next) => update($, tab, () => next),
    label: ($) => read($, label),
    scroll: ($, requestId, by) => update($, memberOf(perPane, { requestId }), (value) => value + by),
    scrolled: ($, requestId) => read($, memberOf(perPane, { requestId })),
    raw: ($) => read($, { plugin: 'hello-tabs', key: 'count' }),
  }
}
`

type Helpers = {
  add($: unknown): Promise<number>
  pick($: unknown, next: string): Promise<string>
  label($: unknown): Promise<string>
  scroll($: unknown, requestId: string, by: number): Promise<number>
  scrolled($: unknown, requestId: string): Promise<number>
  raw($: unknown): Promise<unknown>
}

async function load() {
  const root = scratch()
  writeTree(root, { 'hooks/register.js': MODULE })
  const code = await bundleHooksModule({ module: join(root, 'hooks/register.js'), root })
  const register = runBundle(code).register
  const spaces = createStateSpaces({ changed: () => {} })
  const $ = { state: createStateApi({ plugin: 'hello-tabs', space: root, spaces }) }
  return { mod: (register as unknown as () => Helpers)(), $, spaces, root }
}

test('atom, read and update keep a value in $.state, from its default', async () => {
  const { mod, $ } = await load()
  expect(await mod.label($)).toBe('one:0')
  expect(await mod.add($)).toBe(1)
  expect(await mod.add($)).toBe(2)
  expect(await mod.raw($)).toBe(2)
  expect(await mod.label($)).toBe('one:2')
})

test('a shaped atom stores its shape, and reads its default for a value of another shape', async () => {
  const { mod, $ } = await load()
  await mod.pick($, 'two')
  expect(await $.state.get({ plugin: 'hello-tabs', key: 'tab' })).toMatchObject({
    value: { shape: 2, value: 'two' },
  })
  expect(await mod.label($)).toBe('two:0')
  await $.state.set({ plugin: 'hello-tabs', key: 'tab' }, 'bare')
  expect(await mod.label($)).toBe('one:0')
})

test('memberOf keeps one member of a family per request', async () => {
  const { mod, $ } = await load()
  await mod.scroll($, 'pane-a', 3)
  await mod.scroll($, 'pane-a', 2)
  await mod.scroll($, 'pane-b', 1)
  expect([await mod.scrolled($, 'pane-a'), await mod.scrolled($, 'pane-b')]).toEqual([5, 1])
})

test('update writes again when another write came between its read and its write', async () => {
  const { mod, $ } = await load()
  let raced = false
  const racing = {
    state: {
      get: $.state.get,
      set: async (input: unknown) => {
        if (!raced) {
          raced = true
          await $.state.set({ plugin: 'hello-tabs', key: 'count' }, 10)
        }
        return $.state.set(input)
      },
    },
  }
  expect(await mod.add(racing)).toBe(11)
  expect(await mod.raw($)).toBe(11)
})
