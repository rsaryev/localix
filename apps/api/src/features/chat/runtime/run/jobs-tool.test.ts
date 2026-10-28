import { describe, expect, test } from 'bun:test'
import { testWork } from '../../../../testing/work-fixture'
import { buildJobsTool, buildStopJob } from './jobs-tool'

describe('background jobs terminal lifecycle', () => {
  test('publishes safe agent input activity with the exact PTY id', async () => {
    const events: unknown[] = []
    const work = testWork()
    work.start({
      owner: { userId: 'u1', sessionId: 's1' },
      kind: 'job',
      label: 'python3 -q',
      toolCallId: 'call-1',
      messageId: null,
    })
    work.setTerminal('call-1', 'pty-1')
    const tool = buildJobsTool({
      deps: { streamRegistry: { publish: (...args: unknown[]) => events.push(args) } } as never,
      work,
      userId: 'u1',
      sessionId: 's1',
      runAction: () => true,
    })

    const result = await tool.execute(
      'jobs-call',
      { action: 'send_input', job_id: 'bg-1', input: 'literal secret' },
      undefined,
      undefined,
      undefined,
    )

    expect(result.isError).toBeFalsy()
    expect(events).toEqual([
      [
        'u1',
        's1',
        {
          type: 'terminal.input',
          sessionId: 's1',
          terminalId: 'pty-1',
          source: 'agent',
          label: 'text',
        },
      ],
    ])
    expect(JSON.stringify(events)).not.toContain('literal secret')
  })
})

describe('a pane recorded by its PTY is managed through the terminal', () => {
  // `recordTerminalWork` keys such a pane by `terminal:<id>` and registers no action, so the
  // action registry finds nothing: a stop refused work the prompt had just listed.
  function setup(terminalInput?: boolean) {
    const work = testWork()
    const owner = { userId: 'u1', sessionId: 's1' }
    work.start({
      owner,
      kind: 'job',
      label: 'python3',
      toolCallId: 'terminal:pty-1',
      messageId: null,
    })
    work.setTerminal('terminal:pty-1', 'pty-1')
    const calls: unknown[] = []
    const host = {
      deps: {
        streamRegistry: { publish: () => {} },
        terminalControl: {
          close: (input: unknown) => (calls.push(['close', input]), true),
          write: (input: unknown) => (calls.push(['write', input]), true),
        },
      } as never,
      work,
      userId: 'u1',
      sessionId: 's1',
      terminalInput,
      runAction: () => false,
    }
    const tool = buildJobsTool(host)
    const run = (input: Record<string, string>) =>
      tool.execute('jobs-call', input as never, undefined, undefined, undefined)
    return { calls, run, stop: buildStopJob(host) }
  }

  test('list names its terminal, so the agent can drive it with bash', async () => {
    const { run } = setup()
    expect((await run({ action: 'list' })).content).toContain('bg-1: `python3`')
    expect((await run({ action: 'list' })).content).toContain('terminal pty-1')
  })

  test('TaskStop closes the pane, and only within the session', async () => {
    const { calls, stop } = setup()
    const result = (await stop('bg-1'))!

    expect(result.isError).toBeFalsy()
    expect(calls).toEqual([['close', { userId: 'u1', sessionId: 's1', terminalId: 'pty-1' }]])
  })

  test('send_input types into the pane', async () => {
    const { calls, run } = setup()
    const result = await run({ action: 'send_input', job_id: 'bg-1', input: 'print(1)\n' })

    expect(result.isError).toBeFalsy()
    expect(calls).toEqual([
      ['write', { userId: 'u1', sessionId: 's1', terminalId: 'pty-1', data: 'print(1)\n' }],
    ])
  })

  test('does not suggest bash actions when the run policy hides them', async () => {
    const { run } = setup(false)
    const result = await run({ action: 'send_input', job_id: 'bg-1', input: 'hello' })
    expect(result.isError).toBeFalsy()
    expect(result.content).not.toContain('bash action=')
    expect(result.content).toContain('action="read"')
  })
})
