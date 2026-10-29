import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { ConflictError } from '../../lib/domain-errors'
import { createRecommendedPluginInstalls } from './recommended'

const root = tempDirPerTest('plugin-recommended-')

/** Localix's marketplace recommends `team` and `authoring`; what is installed is a set. */
function setup(opts: { readable?: boolean } = {}) {
  const home = join(root(), 'home')
  const state = { readable: opts.readable ?? true, failing: new Map<string, Error>() }
  const installed = new Set<string>()
  const pass = () =>
    createRecommendedPluginInstalls({
      homeDir: home,
      recommended: async () =>
        state.readable
          ? ['team@localix', 'authoring@localix'].map((id) => ({
              id,
              installed: installed.has(id),
            }))
          : null,
      install: async (id) => {
        const error = state.failing.get(id)
        if (error) throw error
        installed.add(id)
      },
    }).run()
  return { state, installed, pass }
}

describe('the plugins Localix recommends', () => {
  test('are installed without asking, and only once', async () => {
    const { installed, pass } = setup()
    expect(await pass()).toBe('done')
    expect([...installed].sort()).toEqual(['authoring@localix', 'team@localix'])
    installed.delete('team@localix')
    expect(await pass()).toBe('done')
    expect([...installed]).toEqual(['authoring@localix'])
  })

  test('one already installed counts as offered and is left as it is', async () => {
    const { installed, pass } = setup()
    installed.add('team@localix')
    expect(await pass()).toBe('done')
    installed.clear()
    expect(await pass()).toBe('done')
    expect([...installed]).toEqual([])
  })

  test('while the marketplace cannot be read, or an install fails, the pass runs again', async () => {
    const { state, installed, pass } = setup({ readable: false })
    expect(await pass()).toBe('retry')
    state.readable = true
    state.failing.set('team@localix', new Error('offline'))
    expect(await pass()).toBe('retry')
    expect([...installed]).toEqual(['authoring@localix'])
    state.failing.clear()
    expect(await pass()).toBe('done')
    expect([...installed].sort()).toEqual(['authoring@localix', 'team@localix'])
  })

  test('one the install refuses is not asked for again', async () => {
    const { state, installed, pass } = setup()
    state.failing.set('team@localix', new ConflictError('plugin_dependency_missing', 'needs x'))
    expect(await pass()).toBe('done')
    state.failing.clear()
    expect(await pass()).toBe('done')
    expect([...installed]).toEqual(['authoring@localix'])
  })
})
