import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { websocket } from 'hono/bun'
import type { AppContext } from '../../app'
import type { Logger } from '../../lib/logger'
import type { TerminalServerFrame } from './contracts'
import { createTerminalService } from './service'
import { createTerminalStreamRoute } from './ws'

function fixture() {
  let data = (_data: string) => {}
  let exit = (_code: number) => {}
  const service = createTerminalService({
    resolveCwd: async () => '/workspace',
    backend: {
      spawn: () => ({
        write() {},
        resize() {},
        kill() {},
        onData(listener) {
          data = listener
        },
        onExit(listener) {
          exit = listener
        },
      }),
    },
  })
  const app = new Hono<AppContext>()
    .use(async (c, next) => {
      c.set('userId', c.req.query('user') ?? 'u1')
      await next()
    })
    .get('/:id', createTerminalStreamRoute({ service, logger: { warn() {} } as unknown as Logger }))
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: app.fetch, websocket })
  return {
    service,
    server,
    data: (value: string) => data(value),
    exit: (code: number) => exit(code),
  }
}

function read(url: string, onOpen?: () => void): Promise<TerminalServerFrame[]> {
  return new Promise((resolve, reject) => {
    const frames: TerminalServerFrame[] = []
    const socket = new WebSocket(url)
    socket.onopen = () => onOpen?.()
    socket.onmessage = (event) => frames.push(JSON.parse(String(event.data)))
    socket.onerror = () => reject(new Error('Terminal stream failed'))
    socket.onclose = () => resolve(frames)
  })
}

test('an exited command replays its final output and true exit code, scoped to its owner', async () => {
  const f = fixture()
  try {
    const session = await f.service.spawnCommand('u1', {
      sessionId: 's1',
      command: 'bun test',
      cwd: '/workspace/frontend',
    })
    f.data('Error: missing configuration\r\n')
    f.exit(17)
    expect(f.service.get('u1', session.id)).toBeUndefined()
    const url = `ws://127.0.0.1:${f.server.port}/${session.id}`
    expect(await read(url)).toEqual([
      { t: 'data', data: 'Error: missing configuration\r\n' },
      { t: 'exit', code: 17, interactive: false, command: 'bun test', cwd: '/workspace/frontend' },
    ])
    expect(await read(`${url}?user=foreign`)).toEqual([{ t: 'unavailable' }])
  } finally {
    f.service.disposeAll()
    void f.server.stop(true)
  }
}, 5_000)

test('a live stream flushes the final error before sending its exit frame', async () => {
  const f = fixture()
  try {
    const session = await f.service.spawnCommand('u1', { sessionId: 's1', command: 'bun build' })
    const frames = await read(`ws://127.0.0.1:${f.server.port}/${session.id}`, () => {
      f.data('Starting\r\n')
      f.data('Last error\r\n')
      f.exit(1)
    })
    expect(
      frames
        .filter((frame) => frame.t === 'data')
        .map((frame) => frame.data)
        .join(''),
    ).toBe('Starting\r\nLast error\r\n')
    expect(frames.at(-1)).toEqual({
      t: 'exit',
      code: 1,
      interactive: false,
      command: 'bun build',
      cwd: '/workspace',
    })
  } finally {
    f.service.disposeAll()
    void f.server.stop(true)
  }
}, 5_000)
