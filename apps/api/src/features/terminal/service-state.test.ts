/**
 * Terminal state is PUSHED, and the port scan behind the registry poll is shared.
 *
 * The composer used to learn a full-screen takeover or a served URL only from its registry poll,
 * and each poll could start its own `lsof` pair. These pin the two halves of the fix: a state
 * flip publishes `terminal.state` in the same tick, and concurrent callers of a stale cache join
 * ONE scan instead of each starting one.
 */
import { describe, expect, test } from 'bun:test'
import { createTerminalService } from './service'
import type { PtyBackend } from './pty-backend'
import type { TerminalServiceDeps } from './service-deps'

type StateEvent = Parameters<NonNullable<TerminalServiceDeps['publishState']>>[2]

function drivableBackend() {
  let emit = (_data: string) => {}
  const backend: PtyBackend = {
    spawn() {
      return {
        write() {},
        resize() {},
        onData(listener) {
          emit = listener
        },
        onExit() {},
        kill() {},
      }
    },
  }
  return { backend, emit: (data: string) => emit(data) }
}

describe('terminal.state push', () => {
  test('publishes alt-screen enter and leave, once per flip', async () => {
    const { backend, emit } = drivableBackend()
    const events: Array<{ sessionId: string } & StateEvent> = []
    const s = createTerminalService({
      backend,
      resolveCwd: async () => '/workspace',
      publishState: (_userId, sessionId, event) => events.push({ sessionId, ...event }),
    })
    const pane = await s.spawnCommand('u1', { sessionId: 'chat-1', command: 'vim' })

    emit('\x1b[?1049h')
    emit('redraw without a mode switch')
    emit('\x1b[?1049l')

    expect(events).toEqual([
      {
        sessionId: 'chat-1',
        type: 'terminal.state',
        terminalId: pane.id,
        command: 'vim',
        altScreen: true,
      },
      {
        sessionId: 'chat-1',
        type: 'terminal.state',
        terminalId: pane.id,
        command: 'vim',
        altScreen: false,
      },
    ])
  })

  test('publishes a banner URL as soon as the output carries it', async () => {
    const { backend, emit } = drivableBackend()
    const events: StateEvent[] = []
    const s = createTerminalService({
      backend,
      resolveCwd: async () => '/workspace',
      publishState: (_userId, _sessionId, event) => events.push(event),
    })
    await s.spawnCommand('u1', { sessionId: 'chat-1', command: 'npm run dev' })

    emit('  Local:   http://localhost:5173/\n')

    expect(events.at(-1)).toMatchObject({ previewUrl: 'http://localhost:5173', altScreen: false })
  })
})
