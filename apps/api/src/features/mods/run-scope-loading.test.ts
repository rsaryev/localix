import { expect, test } from 'bun:test'
import { join } from 'node:path'
import type { ModSource } from './contracts'
import { createModRunScope } from './run-scope'
import { hostWithMods } from './testing/testing-host'

// At start, and after a plugin change, the mods load a moment later (`refresh`): a turn that starts
// meanwhile runs with them, as a command does, rather than with none (no guard, no tools).
test('a turn that starts while the mods load runs with them', async () => {
  const { host, scene, dir } = await hostWithMods({
    m: (on) => {
      on('session.start', async ($: { tool: { register(def: object): unknown } }, e, next) => {
        await $.tool.register({ name: 'echo', description: 'Echo' })
        return next(e)
      })
    },
  })
  const root = join(dir, 'plugins', 'm')
  const source: ModSource = {
    plugin: 'm',
    root,
    module: join(root, 'hooks/register.js'),
    options: {},
    revision: '2',
  }
  await host.reconcile([])
  const gate = Promise.withResolvers<void>()
  host.refresh(
    async () => {
      await gate.promise
      return [source]
    },
    { failed: () => {} },
  )
  const starting = createModRunScope(host, { ...scene, sessionId: 's2' }, new Set(['m']))
  // The turn has gone as far as it goes before the load answers.
  for (let turn = 0; turn < 20; turn++) await new Promise((r) => setTimeout(r, 0))
  gate.resolve()
  const scope = await starting
  expect(scope.active).toBe(true)
  expect(scope.tools().map((tool) => tool.name)).toEqual(['mcp__m__echo'])
})
