import { describe, expect, test } from 'bun:test'

import type { CommandRun, CommandRunner } from '@rsaryev/llx-plugin'
import type { SubagentStatusTask } from '@rsaryev/llx-plugin/settings'

import { plainRowText, runSubagentStatusLine } from './subagent-status-line'

const task = (id: string): SubagentStatusTask => ({
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

/** A runner that records each run and answers with `stdout` and `exitCode`. */
function fakeRunner(stdout: string, exitCode: number | null = 0) {
  const runs: CommandRun[] = []
  const runner: CommandRunner = {
    run: async (run) => {
      runs.push(run)
      return { exitCode, stdout, stderr: '', timedOut: false }
    },
  }
  return { runs, runner }
}

const base = {
  sessionId: 's1',
  cwd: '/repo',
  columns: 120,
  homeDir: '/home/me',
}

describe('running a subagent status line', () => {
  test('a row body keeps its text and drops colors and hyperlink escapes', () => {
    expect(
      plainRowText('\u001b[32mok\u001b[0m \u001b]8;;https://x.dev\u0007link\u001b]8;;\u0007'),
    ).toBe('ok link')
  })

  test('draws one JSON line per known row as plain text; an empty body hides it', async () => {
    const { runner } = fakeRunner(
      [
        'noise',
        '{"id":"a","content":"\\u001b[1mA\\u001b[0m"}',
        '{"id":"b","content":""}',
        '{"id":"x","content":"?"}',
        '{bad',
      ].join('\n'),
    )
    const rows = await runSubagentStatusLine({
      ...base,
      line: { command: 'rows.sh' },
      tasks: [task('a'), task('b')],
      runner,
    })
    expect(rows).toEqual([
      { id: 'a', content: 'A' },
      { id: 'b', content: '' },
    ])
  })

  test('runs the command with the rows on stdin and the plugin roots in its environment', async () => {
    const { runs, runner } = fakeRunner('{"id":"child-1","content":"⚙ parser"}\n')
    const rows = await runSubagentStatusLine({
      ...base,
      line: { command: 'row.sh', plugin: { id: 'p@m', name: 'p', root: '/plugins/p' } },
      tasks: [task('child-1')],
      runner,
    })
    expect(rows).toEqual([{ id: 'child-1', content: '⚙ parser' }])
    const run = runs[0]
    expect(run?.spec).toEqual({ form: 'shell', command: 'row.sh', shell: 'bash' })
    expect(JSON.parse(run?.stdin ?? '')).toMatchObject({
      session_id: 's1',
      cwd: '/repo',
      columns: 120,
      tasks: [{ id: 'child-1', type: 'local_agent', tokenCount: 1200 }],
    })
    expect(run?.env.CLAUDE_PLUGIN_ROOT).toBe('/plugins/p')
    expect(run?.env.CLAUDE_PLUGIN_DATA).toContain('p-m')
    expect(run?.env.CLAUDE_PROJECT_DIR).toBe('/repo')
    expect(run?.cwd).toBe('/repo')
    // The 5 s limit reaches the runner as a signal that is not yet aborted.
    expect(run?.signal.aborted).toBe(false)
  })

  test('a failing command rewrites nothing', async () => {
    const { runner } = fakeRunner('{"id":"child-1","content":"x"}', 1)
    const rows = await runSubagentStatusLine({
      ...base,
      line: { command: 'false' },
      tasks: [task('child-1')],
      runner,
    })
    expect(rows).toEqual([])
  })

  test('with no rows to rewrite nothing runs', async () => {
    const { runs, runner } = fakeRunner('')
    const rows = await runSubagentStatusLine({ ...base, line: { command: 'x' }, tasks: [], runner })
    expect(rows).toEqual([])
    expect(runs).toEqual([])
  })
})
