import { describe, expect, test } from 'bun:test'

import { sessionFixture } from '../../../testing/session-fixture'
import type { PluginCatalog } from '../../plugins/catalog'
import { createSubagentRows } from './subagent-rows'

const catalog = (command?: string) =>
  ({
    enabled: [
      {
        plugin: {
          dir: '/plugins/rows',
          manifest: { name: 'rows' },
          entrypoints: {
            components: {
              settings: command ? { subagentStatusLine: { type: 'command', command } } : {},
            },
          },
        },
      },
    ],
  }) as unknown as PluginCatalog

function rows(command: string | undefined, inputs: string[]) {
  const parent = sessionFixture({ id: 'parent' })
  const child = { ...sessionFixture({ id: 'child', title: 'Map the parser' }), taskName: 'mapper' }
  return createSubagentRows({
    requireSession: async () => parent,
    getSession: async (_user, id) => (id === 'child' ? child : null),
    buildSessionPluginCatalog: async () => catalog(command),
    resolveSessionWorkingDir: async () => '/repo',
    listDelegatedRuns: async () => [
      {
        sessionId: 'child',
        taskName: 'mapper',
        status: 'running',
        usage: { tokens: 42, costUsd: null },
      },
      { sessionId: 'old', taskName: 'old', status: 'closed' },
    ],
    streamRegistry: { hasWatchers: () => true, publish: () => {} },
    // Nothing fires: these tests read once.
    timers: { set: () => 0, clear: () => {} },
    homeDir: '/home/me',
    run: async (options) => {
      inputs.push(options.input)
      return {
        code: 0,
        stdout: '{"id":"child","content":"mapper · 42 tok"}',
        stderr: '',
        timedOut: false,
        aborted: false,
      }
    },
  })
}

describe('subagent rows', () => {
  test('a plugin status line rewrites the open children, given in Claude Code task fields', async () => {
    const inputs: string[] = []
    const view = await rows('rows.sh', inputs).getSubagentRows(parentUser(), 'parent')
    expect(view).toEqual({ active: true, rows: [{ id: 'child', content: 'mapper · 42 tok' }] })
    const sent = JSON.parse(inputs[0]!)
    expect(sent.columns).toBe(80)
    expect(sent.tasks).toHaveLength(1)
    expect(sent.tasks[0]).toMatchObject({
      id: 'child',
      name: 'mapper',
      type: 'local_agent',
      status: 'running',
      description: 'Map the parser',
      tokenCount: 42,
      tokenSamples: [42],
      cwd: '/repo',
    })
  })

  test('without one the rows are inactive, and nothing runs', async () => {
    const inputs: string[] = []
    const view = await rows(undefined, inputs).getSubagentRows(parentUser(), 'parent')
    expect(view).toEqual({ active: false, rows: [] })
    expect(inputs).toEqual([])
  })
})

function parentUser() {
  return sessionFixture().userId
}
