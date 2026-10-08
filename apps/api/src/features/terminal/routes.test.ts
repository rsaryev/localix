import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { AppContext } from '../../app'
import { testWork } from '../../testing/work-fixture'
import { createTerminalRoutes } from './routes'
import type { TerminalService } from './service'

/** A terminal service whose spawned PTY exits when the test says so. */
function fakeTerminals() {
  const exits: Array<(code: number) => void> = []
  const service = {
    spawnCommand: async () => ({
      id: 'pty-1',
      onExit: (listener: (code: number) => void) => {
        exits.push(listener)
        return () => {}
      },
    }),
  } as unknown as TerminalService
  return { service, exit: (code: number) => exits.forEach((listener) => listener(code)) }
}

function app(service: TerminalService, work: ReturnType<typeof testWork>) {
  return new Hono<AppContext>()
    .use(async (c, next) => {
      c.set('userId', 'u1')
      await next()
    })
    .route('/', createTerminalRoutes(service, work))
}

const spawn = (body: Record<string, unknown>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('a server started from the preview is the session’s work', () => {
  test('it is listed while it runs and ends when its PTY exits', async () => {
    // The composer lists work; without a record, a dev server started from the preview was
    // invisible there once the strip stopped listing raw terminals.
    const terminals = fakeTerminals()
    const work = testWork()
    const res = await app(terminals.service, work).request(
      '/spawn',
      spawn({ sessionId: 's1', command: 'bun dev' }),
    )
    expect(res.status).toBe(201)
    expect(work.list({ userId: 'u1', sessionId: 's1' })).toMatchObject([
      { kind: 'job', label: 'bun dev', terminalId: 'pty-1', agentId: null },
    ])

    terminals.exit(0)
    expect(work.list({ userId: 'u1', sessionId: 's1' })).toEqual([])
  })
})

describe('there is no unbound terminal', () => {
  // A request without a session used to open a PTY in $HOME bound to nothing: no session
  // listed it, and deleting a chat never closed it. Both endpoints now refuse before spawning.
  test('a spawn that names no session is rejected and spawns nothing', async () => {
    let spawned = 0
    const service = {
      spawnCommand: async () => {
        spawned += 1
        throw new Error('must not spawn')
      },
    } as unknown as TerminalService
    const work = testWork()
    const res = await app(service, work).request('/spawn', spawn({ command: 'bun dev' }))
    expect(res.status).toBe(400)
    expect(spawned).toBe(0)
    expect(work.owners()).toEqual([])
  })

  test('opening a terminal that names no session is rejected and opens nothing', async () => {
    let opened = 0
    const service = {
      open: async () => {
        opened += 1
        throw new Error('must not open')
      },
    } as unknown as TerminalService
    const res = await app(service, testWork()).request('/', spawn({}))
    expect(res.status).toBe(400)
    expect(opened).toBe(0)
  })
})

test('the spawn request preserves the launch directory instead of stripping it', async () => {
  let received: unknown
  const service = {
    spawnCommand: async (_userId: string, input: unknown) => {
      received = input
      return { id: 'pty-cwd', onExit() {} }
    },
  } as unknown as TerminalService
  const response = await app(service, testWork()).request(
    '/spawn',
    spawn({ sessionId: 's1', command: 'bun dev', cwd: '/work/frontend' }),
  )
  expect(response.status).toBe(201)
  expect(received).toMatchObject({ sessionId: 's1', command: 'bun dev', cwd: '/work/frontend' })
})
