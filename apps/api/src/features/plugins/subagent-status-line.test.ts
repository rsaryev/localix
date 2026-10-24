import { describe, expect, test } from 'bun:test'

import type { PluginCatalog } from './catalog'
import {
  activeSubagentStatusLine,
  parseSubagentRows,
  plainRowText,
  runSubagentStatusLine,
  type SubagentTask,
} from './subagent-status-line'

const entry = (name: string, command?: string) => ({
  plugin: {
    dir: `/plugins/${name}`,
    manifest: { name },
    entrypoints: {
      components: { settings: command ? { subagentStatusLine: { type: 'command', command } } : {} },
    },
  },
})

const task = (id: string): SubagentTask => ({
  id,
  type: 'local_agent',
  agentType: 'Explore',
  status: 'running',
  description: 'Map the parser',
  label: 'Reading src/',
  startTime: 1,
  tokenCount: 1200,
  tokenSamples: [1200],
  cwd: '/repo',
})

describe('a plugin subagent status line', () => {
  test('the plugin loaded last sets it', () => {
    const catalog = {
      enabled: [entry('a', 'a.sh'), entry('b'), entry('c', 'c.sh')],
    } as unknown as PluginCatalog
    expect(activeSubagentStatusLine(catalog)).toEqual({
      pluginName: 'c',
      pluginRoot: '/plugins/c',
      pluginId: 'c',
      command: 'c.sh',
    })
    expect(activeSubagentStatusLine({ enabled: [entry('b')] } as unknown as PluginCatalog)).toBe(
      null,
    )
  })

  test('a row body keeps its text and drops colors and hyperlink escapes', () => {
    expect(
      plainRowText('\u001b[32mok\u001b[0m \u001b]8;;https://x.dev\u0007link\u001b]8;;\u0007'),
    ).toBe('ok link')
  })

  test('reads one JSON line per known row; an empty body hides it, other lines are ignored', () => {
    const rows = parseSubagentRows(
      [
        'noise',
        '{"id":"a","content":"\\u001b[1mA\\u001b[0m"}',
        '{"id":"b","content":""}',
        '{"id":"x","content":"?"}',
        '{bad',
      ].join('\n'),
      new Set(['a', 'b']),
    )
    expect(rows).toEqual([
      { id: 'a', content: 'A' },
      { id: 'b', content: '' },
    ])
  })

  test('runs the command with the rows on stdin and the plugin roots in its environment', async () => {
    const seen: { input?: string; env?: NodeJS.ProcessEnv; cwd?: string } = {}
    const rows = await runSubagentStatusLine({
      line: { pluginName: 'p', pluginRoot: '/plugins/p', command: 'row.sh' },
      tasks: [task('child-1')],
      sessionId: 's1',
      cwd: '/repo',
      columns: 120,
      homeDir: '/home/me',
      run: async (options) => {
        Object.assign(seen, { input: options.input, env: options.env, cwd: options.cwd })
        return {
          code: 0,
          stdout: '{"id":"child-1","content":"⚙ parser"}\n',
          stderr: '',
          timedOut: false,
          aborted: false,
        }
      },
    })
    expect(rows).toEqual([{ id: 'child-1', content: '⚙ parser' }])
    expect(JSON.parse(seen.input!)).toMatchObject({
      session_id: 's1',
      columns: 120,
      tasks: [{ id: 'child-1', type: 'local_agent', tokenCount: 1200 }],
    })
    expect(seen.env?.CLAUDE_PLUGIN_ROOT).toBe('/plugins/p')
    expect(seen.env?.CLAUDE_PROJECT_DIR).toBe('/repo')
    expect(seen.cwd).toBe('/repo')
  })

  test('a failing command rewrites nothing', async () => {
    const rows = await runSubagentStatusLine({
      line: { pluginName: 'p', pluginRoot: '/p', command: 'false' },
      tasks: [task('child-1')],
      sessionId: 's1',
      cwd: '/repo',
      columns: 80,
      homeDir: '/home/me',
      run: async () => ({
        code: 1,
        stdout: '{"id":"child-1","content":"x"}',
        stderr: 'boom',
        timedOut: false,
        aborted: false,
      }),
    })
    expect(rows).toEqual([])
  })
})
