import { describe, expect, test } from 'bun:test'
import { Terminal } from '@xterm/headless'
import { hasUserInput } from './input-activity'
import { createTerminalService } from './service'
import type { PtyBackend } from './pty-backend'

describe('terminal input activity', () => {
  test.each([
    '',
    '\x1b[12;34R',
    '\x1b[?12;34R',
    '\x1b[?1;2c',
    '\x1b[>0;276;0c',
    '\x1b[0n',
    '\x1b[I',
    '\x1b[O',
    '\x1b]10;rgb:ffff/ffff/ffff\x07',
    '\x1b]4;0;rgb:0000/0000/0000\x1b\\',
    '\x1b[12;34R\x1b[?1;2c',
  ])('automatic report %j is not a user interaction', (data) => {
    expect(hasUserInput(data)).toBe(false)
  })

  test.each([
    'hello',
    ' ',
    '\r',
    '\n',
    '\x03',
    '\x1b',
    '\x1b[A',
    '\x1bOA',
    '\x1bOP',
    '\x1b[Z',
    '\x1b[<0;10;20M',
    '\x1b[200~paste\x1b[201~',
    '\x1b[12;34Rtyped',
    '\x1b[?1;2c\r',
    '\x1b[unknown',
  ])('real or unrecognized input %j stays activity', (data) => {
    expect(hasUserInput(data)).toBe(true)
  })

  test('actual xterm query replies reach the process without creating interaction notices', async () => {
    const writes: string[] = []
    const notices: unknown[] = []
    const backend: PtyBackend = {
      spawn: () => ({
        write: (data) => {
          writes.push(data)
        },
        onData() {},
        onExit() {},
        resize() {},
        kill() {},
      }),
    }
    const service = createTerminalService({
      backend,
      resolveCwd: async () => '/workspace',
      shellIntegration: false,
      publishLifecycle: (_user, _session, event) => {
        notices.push(event)
      },
    })
    const emulator = new Terminal({ cols: 80, rows: 24 })
    try {
      const terminal = await service.spawnCommand('u1', { sessionId: 's1', command: 'tui' })
      emulator.onData((data) => {
        service.writeUserInput('u1', terminal.id, data)
      })
      await new Promise<void>((resolve) => emulator.write('\x1b[6n\x1b[c\x1b[>c', resolve))
      expect(writes).toHaveLength(3)
      expect(writes.every((data) => !hasUserInput(data))).toBe(true)
      expect(notices).toEqual([])
      // Reports must not consume the typing throttle window either.
      expect(service.writeUserInput('u1', terminal.id, '\r')).toBe(true)
      expect(notices).toEqual([
        { type: 'terminal.input', terminalId: terminal.id, source: 'user', label: 'user input' },
      ])
    } finally {
      emulator.dispose()
      service.disposeAll()
    }
  })
})
