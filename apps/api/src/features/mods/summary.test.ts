import { expect, test } from 'bun:test'
import { summarize } from './summary'

test('each plugin row lists its mod with its version, what it hooks, its panes and why one failed', () => {
  // The version is the one the plugin loaded with (the kit's manifest, its entry's when it has no
  // plugin.json), not a second read of the folder's plugin.json.
  expect(
    summarize({
      sources: [{ plugin: 'suggester', version: '1.2.0' }, { plugin: 'unversioned' }],
      events: new Map([['suggester', ['turn.complete', 'ui.render']]]),
      failures: new Map([['broken', 'register threw: no such file']]),
      panes: [{ plugin: 'suggester' }],
    }),
  ).toEqual([
    {
      plugin: 'suggester',
      version: '1.2.0',
      events: ['turn.complete', 'ui.render'],
      panes: 1,
      draws: true,
      status: 'running',
    },
    { plugin: 'unversioned', events: [], panes: 0, draws: false, status: 'running' },
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
