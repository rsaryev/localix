import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { summarize } from './summary'

const scratch = tempDirPerTest('mods-summary', {})

test('the Mods view lists each mod with its version, what it hooks, its panes and why one failed', () => {
  const root = scratch()
  mkdirSync(join(root, '.claude-plugin'))
  writeFileSync(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ version: '1.2.0' }))
  expect(
    summarize({
      roots: new Map([['next-steps', root]]),
      events: new Map([['next-steps', ['turn.complete', 'ui.render']]]),
      failures: new Map([['broken', 'register threw: no such file']]),
      panes: [{ plugin: 'next-steps' }],
    }),
  ).toEqual([
    {
      plugin: 'next-steps',
      version: '1.2.0',
      events: ['turn.complete', 'ui.render'],
      panes: 1,
      draws: true,
      status: 'running',
    },
    {
      plugin: 'broken',
      events: [],
      panes: 0,
      draws: false,
      status: 'failed',
      problem: 'register threw: no such file',
    },
  ])
})
