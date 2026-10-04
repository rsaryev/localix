import { describe, expect, it } from 'bun:test'

import { announcePtyOpen } from './pty-announce'

// Regression: agent-spawned PTYs (bash background jobs + bash action:"open"
// interactive terminals) must announce themselves as `terminal.opened` so the UI
// reveals the pane immediately. The poll-driven alt-screen auto-reveal alone is
// not enough — full-screen apps like `claude` never enter the alternate screen,
// and the idle poll can lag 15s (the "terminal didn't auto-open" bug).
describe('announcePtyOpen', () => {
  it('publishes terminal.opened with the spawned terminalId + command, after the open resolves', async () => {
    const published: unknown[] = []
    const open = announcePtyOpen(
      async (_input: { command: string }) => ({ terminalId: 'pty-1', extra: 'kept' }),
      (event) => published.push(event),
      'session-1',
    )

    const result = await open({ command: 'claude' })

    expect(result).toEqual({ terminalId: 'pty-1', extra: 'kept' })
    expect(published).toEqual([
      { type: 'terminal.opened', sessionId: 'session-1', terminalId: 'pty-1', command: 'claude' },
    ])
  })

  it('does not publish when the spawn fails', () => {
    const published: unknown[] = []
    const open = announcePtyOpen(
      async (_input: { command: string }): Promise<{ terminalId: string }> => {
        throw new Error('spawn failed')
      },
      (event) => published.push(event),
      'session-1',
    )

    expect(open({ command: 'vim' })).rejects.toThrow('spawn failed')
    expect(published).toEqual([])
  })
})
