import { describe, expect, test } from 'bun:test'

import { latestActiveTerminalWait } from './terminal-lifecycle'

describe('latestActiveTerminalWait', () => {
  test('selects the newest active wait and falls back after it settles', () => {
    const messages = [
      {
        terminalLifecycle: {
          kind: 'waiting' as const,
          terminalId: 'pty-1',
          active: true,
          label: 'first prompt',
        },
      },
      {
        terminalLifecycle: {
          kind: 'waiting' as const,
          terminalId: 'pty-2',
          active: false,
          label: 'second prompt',
        },
      },
    ]

    expect(latestActiveTerminalWait(messages)).toEqual({
      terminalId: 'pty-1',
      label: 'first prompt',
    })
  })

  test('ignores input and finished activity', () => {
    expect(
      latestActiveTerminalWait([
        { terminalLifecycle: { kind: 'input', terminalId: 'pty-1' } },
        { terminalLifecycle: { kind: 'finished', terminalId: 'pty-1' } },
      ]),
    ).toBeNull()
  })
})
