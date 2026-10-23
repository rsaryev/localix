import { expect, spyOn, test } from 'bun:test'
import type { TerminalRead } from '@localixai/mini-app-sdk/backend'
import { AgentSessionsService } from './service'
import type { ProviderAdapter, SourceRef } from './adapters/types'

interface PollInternals {
  timers: Set<ReturnType<typeof setTimeout>>
  turnSources: Map<string, { adapter: ProviderAdapter; ref: SourceRef }>
  readTurnsFor(keys: readonly string[]): Promise<void>
}

async function withPoll(
  run: (fixture: {
    service: AgentSessionsService
    internals: PollInternals
    calls: string[]
    tick: () => void
    changed: () => void
  }) => Promise<void>,
) {
  const service = new AgentSessionsService('.', () => {}, { env: {}, homeDir: '.' })
  const internals = service as unknown as PollInternals
  const calls: string[] = []
  let tick = () => {}
  let changed = () => {}
  const handle = {} as ReturnType<typeof setInterval>
  const interval = spyOn(globalThis, 'setInterval').mockImplementation(((
    callback: () => void,
    delay?: number,
  ) => {
    expect(delay).toBe(2_000)
    tick = callback as () => void
    return handle
  }) as typeof setInterval)
  const clear = spyOn(globalThis, 'clearInterval').mockImplementation((timer) => {
    expect(timer).toBe(handle)
    calls.push('interval.clear')
  })
  const controller = new AbortController()
  let waiting: ReturnType<AgentSessionsService['wait']> | undefined
  try {
    for (const id of ['one', 'two']) {
      service.live.open({ terminalId: id, localixSessionId: 'asking', provider: 'codex' })
      service.live.adopt(id, id)
      internals.turnSources.set(`codex:${id}`, {
        adapter: {} as ProviderAdapter,
        ref: { nativeSessionId: id, sourcePath: '/fixture/shared.jsonl', revision: '' },
      })
    }
    internals.readTurnsFor = async () => {
      calls.push('turns.initial')
    }
    const armed = Promise.withResolvers<void>()
    service.setPathWatch((path, recursive, onEvent) => {
      expect(path).toBe('/fixture/shared.jsonl')
      expect(recursive).toBe(false)
      expect(internals.timers.size).toBe(1)
      calls.push('watch.arm')
      changed = () => onEvent(null)
      armed.resolve()
      return () => calls.push('watch.close')
    })
    waiting = service.wait(
      {
        keys: ['codex:one', 'codex:two'],
        mode: 'all',
        until: ['done'],
        timeoutMs: 30_000,
      },
      controller.signal,
      'asking',
    )
    await armed.promise
    expect(calls).toEqual(['turns.initial', 'watch.arm'])
    await run({ service, internals, calls, tick: () => tick(), changed: () => changed() })
    controller.abort()
    await waiting
    expect(calls.slice(-2)).toEqual(['watch.close', 'interval.clear'])
    expect(internals.timers.size).toBe(0)
  } finally {
    controller.abort()
    await waiting
    service.shutdown()
    interval.mockRestore()
    clear.mockRestore()
  }
}

test('wait ticks resolve the current readers and keep reading logs without a terminal reader', async () => {
  await withPoll(async ({ service, internals, calls, tick }) => {
    tick()
    await Promise.resolve()
    expect(calls.slice(2)).toEqual(['turns.initial'])
    service.setTerminalRead({} as TerminalRead)
    service.readScreen = async (key, sessionId) => {
      calls.push(`screen:${key}:${sessionId}`)
      throw new Error('pane vanished')
    }
    internals.readTurnsFor = async (keys) => {
      calls.push(`turns.current:${keys.join(',')}`)
      throw new Error('log moved')
    }
    tick()
    await Promise.resolve()
    expect(calls.slice(3)).toEqual([
      'screen:codex:one:asking',
      'screen:codex:two:asking',
      'turns.current:codex:one,codex:two',
    ])
  })
})

test('a watched log change uses the current log reader without reading screens', async () => {
  await withPoll(async ({ service, internals, calls, changed }) => {
    service.setTerminalRead({} as TerminalRead)
    service.readScreen = async () => {
      calls.push('screen')
      return null
    }
    internals.readTurnsFor = async (keys) => {
      calls.push(`turns.changed:${keys.join(',')}`)
    }
    changed()
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(calls.slice(2)).toEqual(['turns.changed:codex:one,codex:two'])
  })
})
