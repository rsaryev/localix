import { afterEach, describe, expect, it } from 'bun:test'

import { createPluginConditions, observePluginConditions, recordPluginCatalogLoad } from './plugins'
import {
  createTestJournal,
  openRows,
  TEST_USER as U,
  type TestJournal,
} from './testing/test-journal'

const journals: TestJournal[] = []
afterEach(async () => {
  observePluginConditions(undefined)
  await Promise.all(journals.splice(0).map((j) => j.close()))
})

async function setup() {
  const test = await createTestJournal()
  journals.push(test)
  return { test, plugins: createPluginConditions(test.journal, U) }
}

describe('plugin conditions', () => {
  it('a failed load is one row, settles on a clean load, and reopens when it fails again', async () => {
    const { test, plugins } = await setup()
    const failed = {
      name: 'tracker',
      displayName: 'Tracker',
      projectId: '',
      error: 'SyntaxError: x',
    }
    plugins.loaded(U, failed)
    plugins.loaded(U, failed)
    expect((await openRows(test)).map((row) => row.title)).toEqual([
      'Could not load the Tracker plugin',
    ])

    plugins.loaded(U, { name: 'tracker', projectId: '' })
    expect(await openRows(test)).toEqual([])
    plugins.loaded(U, failed)
    expect(await openRows(test)).toMatchObject([
      { occurrenceCount: 2, origin: { label: 'Tracker' } },
    ])
  })

  it('a whole-load failure is one row per workspace, settled by the next load that completes', async () => {
    const { test, plugins } = await setup()
    observePluginConditions(plugins)
    recordPluginCatalogLoad(U, 'P1', new Error('ENOENT: plugins.json'))
    recordPluginCatalogLoad(U, 'P1', new Error('ENOENT: plugins.json'))
    recordPluginCatalogLoad(U, 'P2')
    let open = await openRows(test)
    expect(open.map((row) => [row.title, row.body?.includes('ENOENT')])).toEqual([
      ['Could not load plugins', true],
    ])
    recordPluginCatalogLoad(U, 'P1')
    open = await openRows(test)
    expect(open).toEqual([])
  })

  it('retires every row about a plugin no scope enables any more, and nothing else', async () => {
    const { test, plugins } = await setup()
    plugins.loaded(U, { name: 'gone', projectId: '', error: 'boom' })
    plugins.monitorStopped('gone', 'watch', 'Its command exited with code 1.')
    plugins.loaded(U, { name: 'kept', projectId: '', error: 'boom' })
    await plugins.enabled(new Set(['kept']))
    const open = (await openRows(test)).map((row) => row.key.split(':').slice(1, 3).join(':'))
    expect(open).toEqual(['plugin:kept'])
  })

  it('reports a dead monitor, cleared by its next start, on the Plugins shelf', async () => {
    const { test, plugins } = await setup()
    plugins.monitorStopped('chat', 'tail', 'Its command ended.')
    const [row] = await openRows(test)
    expect(row?.title).toBe('The chat monitor “tail” stopped')
    expect(JSON.stringify(row?.actions)).toContain('kind=plugin')
    plugins.monitorStarted('chat', 'tail')
    expect(await openRows(test)).toEqual([])
  })
})
