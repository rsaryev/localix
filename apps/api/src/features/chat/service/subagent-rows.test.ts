import { describe, expect, test } from 'bun:test'

import { sessionFixture } from '../../../testing/session-fixture'
import type { PluginCatalog } from '../../plugins/catalog'
import { createSubagentRows } from './subagent-rows'

/** A conversation whose kit session runs `command` as the person's own settings value, or none. */
const kitSession = (command?: string) => ({
  subagentStatusLine: () => ({
    runs: command
      ? { value: { type: 'command', command } as const, scope: 'user' as const }
      : undefined,
  }),
})

function rows(
  command: string | undefined,
  inputs: string[],
  more: Partial<Parameters<typeof createSubagentRows>[0]> = {},
) {
  const parent = sessionFixture({ id: 'parent' })
  const child = { ...sessionFixture({ id: 'child', title: 'Map the parser' }), taskName: 'mapper' }
  return createSubagentRows({
    requireSession: async () => parent,
    getSession: async (_user, id) => (id === 'child' ? child : null),
    buildSessionPluginCatalog: async () => ({ all: [] }) as unknown as PluginCatalog,
    chatPluginSession: async () => kitSession(command),
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
      envs.push(options.env ?? {})
      return {
        code: 0,
        stdout: '{"id":"child","content":"mapper · 42 tok"}',
        stderr: '',
        timedOut: false,
        aborted: false,
      }
    },
    ...more,
  })
}

const envs: NodeJS.ProcessEnv[] = []

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

test("a plugin's default runs in the folder of the catalog's plugin of that id", async () => {
  envs.length = 0
  const plugin = {
    dir: '/plugins/rows',
    manifest: { name: 'rows' },
    cachedInstall: { id: 'rows@m' },
    scope: 'user',
    kit: {},
  }
  const view = await rows(undefined, [], {
    buildSessionPluginCatalog: async () =>
      ({ all: [{ plugin, state: undefined, enabled: true }] }) as unknown as PluginCatalog,
    chatPluginSession: async () => ({
      subagentStatusLine: () => ({
        runs: {
          value: { type: 'command', command: 'rows.sh' },
          plugin: { id: 'rows@m', name: 'rows', settings: {} },
        },
      }),
    }),
  }).getSubagentRows(parentUser(), 'parent')
  expect(view.active).toBe(true)
  expect(envs[0]?.CLAUDE_PLUGIN_ROOT).toBe('/plugins/rows')
})

test('a conversation without a kit session runs none', async () => {
  const inputs: string[] = []
  const view = await rows('rows.sh', inputs, {
    chatPluginSession: async () => undefined,
  }).getSubagentRows(parentUser(), 'parent')
  expect(view).toEqual({ active: false, rows: [] })
  expect(inputs).toEqual([])
})

function parentUser() {
  return sessionFixture().userId
}
