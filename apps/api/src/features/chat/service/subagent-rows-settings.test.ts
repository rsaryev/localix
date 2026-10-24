import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { sessionFixture } from '../../../testing/session-fixture'
import type { PluginCatalog } from '../../plugins/catalog'
import { createSubagentRows } from './subagent-rows'

/**
 * `subagentStatusLine` in a person's own Claude Code settings rewrites the subagent rows, over any
 * plugin's default (settings-reference.md, `subagentStatusLine`: "Scope: Any file").
 */
const scratch = tempDirPerTest('cc-subagent-rows-settings-')

test("the settings' subagentStatusLine runs, in the conversation's folder", async () => {
  const root = scratch()
  writeTree(root, {
    'home/.claude/settings.json': JSON.stringify({
      subagentStatusLine: { type: 'command', command: 'mine.sh' },
    }),
    'repo/.keep': '',
  })
  const commands: string[] = []
  const parent = sessionFixture({ id: 'parent' })
  const rows = createSubagentRows({
    requireSession: async () => parent,
    getSession: async (_user, id) => (id === 'child' ? sessionFixture({ id: 'child' }) : null),
    buildSessionPluginCatalog: async () =>
      ({
        enabled: [
          {
            plugin: {
              dir: '/plugins/rows',
              manifest: { name: 'rows' },
              entrypoints: {
                components: {
                  settings: { subagentStatusLine: { type: 'command', command: 'plugin.sh' } },
                },
              },
            },
          },
        ],
      }) as unknown as PluginCatalog,
    resolveSessionWorkingDir: async () => join(root, 'repo'),
    listDelegatedRuns: async () => [{ sessionId: 'child', taskName: 'x', status: 'running' }],
    streamRegistry: { hasWatchers: () => true, publish: () => {} },
    timers: { set: () => 0, clear: () => {} },
    homeDir: join(root, 'home'),
    run: async (options) => {
      commands.push(options.command)
      return { code: 0, stdout: '', stderr: '', timedOut: false, aborted: false }
    },
  })
  const view = await rows.getSubagentRows('u1', 'parent')
  expect(view.active).toBe(true)
  expect(commands).toEqual(['mine.sh'])
})
