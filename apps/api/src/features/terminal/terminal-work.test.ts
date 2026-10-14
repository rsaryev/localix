import { describe, expect, test } from 'bun:test'

import { testWork } from '../../testing/work-fixture'
import { recordTerminalWork } from './terminal-work'

const owner = { userId: 'u1', sessionId: 's1' }

/** A pane whose exit the test decides. */
function pane(id: string) {
  const exits: Array<(code: number) => void> = []
  return {
    terminal: {
      id,
      onExit: (listener: (code: number) => void) => exits.push(listener),
    },
    exit: (code: number) => exits.forEach((listener) => listener(code)),
  }
}

describe('a pane outside the bash job path is the session’s work', () => {
  test('an agent’s interactive pane is listed with its terminal and its agent while it runs', () => {
    // Without the record, the agent's own `bash action:"open"` pane reached no reader of the
    // registry: not the prompt's job section, not `jobs`, not the composer's strip.
    const work = testWork()
    const { terminal } = pane('pty-1')
    recordTerminalWork(work, { owner, agentId: 'coder', label: 'python3', terminal })

    expect(work.list(owner)).toMatchObject([
      { displayId: 'bg-1', label: 'python3', terminalId: 'pty-1', agentId: 'coder' },
    ])
  })

  test('how it ended follows its exit: done, closed, or failed', () => {
    const work = testWork()
    const ended: Array<{ status: string; exitCode: number | null }> = []
    work.onEnded((record) => ended.push({ status: record.status, exitCode: record.exitCode }))
    const panes = ['pty-ok', 'pty-closed', 'pty-crashed'].map((id) => {
      const p = pane(id)
      recordTerminalWork(work, { owner, agentId: null, label: id, terminal: p.terminal })
      return p
    })

    panes[0]!.exit(0)
    // `close` disposes the pane, which exits it with 130: it was stopped, not failed.
    panes[1]!.exit(130)
    panes[2]!.exit(1)

    expect(ended).toEqual([
      { status: 'succeeded', exitCode: 0 },
      { status: 'cancelled', exitCode: 130 },
      { status: 'failed', exitCode: 1 },
    ])
    expect(work.list(owner)).toEqual([])
  })
})
