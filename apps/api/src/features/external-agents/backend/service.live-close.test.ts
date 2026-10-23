import { expect, test } from 'bun:test'
import { mkdtemp, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TerminalRead } from '@localixai/mini-app-sdk/backend'
import { AgentSessionsService } from './service'
import type { ProviderAdapter, SourceRef } from './adapters/types'
import { pendingKeyFor, type LiveEntry } from './live/store'

const screen = (text: string) => ({ text }) as Awaited<ReturnType<TerminalRead['screen']>>

function reader(live: Set<string>): TerminalRead {
  return {
    screen: async ({ terminalId }) => (live.has(terminalId) ? screen('working…') : null),
    finalScreen: async ({ terminalId }) => (live.has(terminalId) ? null : screen('bye')),
    list: () => [...live].map((terminalId) => ({ terminalId })),
  }
}

test('an agent whose terminal exited leaves the roster instead of staying live', async () => {
  const service = new AgentSessionsService(
    '.',
    () => {},
    { env: {}, homeDir: '/nonexistent' },
    () => [],
  )
  const running = new Set(['t1', 't2'])
  service.setTerminalRead(reader(running))
  service.live.open({ terminalId: 't1', localixSessionId: 's', provider: 'codex' })
  service.live.open({ terminalId: 't2', localixSessionId: 's', provider: 'codex' })
  running.delete('t2')
  await service.roster({}, 's')
  expect(service.live.get('t1')?.closed).toBeFalsy()
  expect(service.live.get('t2')?.closed).toBe(true)
  service.shutdown()
})

test('a waited pane that exits ends the wait on its exit event, not a timer', async () => {
  const service = new AgentSessionsService(
    '.',
    () => {},
    { env: {}, homeDir: '/nonexistent' },
    () => [],
  )
  const running = new Set(['t1'])
  const armed = Promise.withResolvers<(event: 'output' | 'exit') => void>()
  service.setTerminalRead({
    ...reader(running),
    watch: ({ sessionId, terminalId }, onEvent) => {
      expect([sessionId, terminalId]).toEqual(['s', 't1'])
      armed.resolve(onEvent)
      return () => {}
    },
  })
  service.live.open({ terminalId: 't1', localixSessionId: 's', provider: 'codex' })
  const waiting = service.wait(
    { keys: [pendingKeyFor('codex', 't1')], mode: 'all', until: ['done'], timeoutMs: 30_000 },
    undefined,
    's',
  )
  const emit = await armed.promise
  running.delete('t1')
  emit('exit')
  const outcome = await waiting
  expect(outcome.satisfied).toBe(true)
  expect(service.live.get('t1')?.closed).toBe(true)
  service.shutdown()
})

test('the turn reading is aged by the log as it is now, not as it was first found', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'turn-mtime-'))
  const path = join(dir, 'log.jsonl')
  await writeFile(path, '{}\n')
  const service = new AgentSessionsService(
    dir,
    () => {},
    { env: {}, homeDir: dir },
    () => [],
  )
  const seen: (number | undefined)[] = []
  const adapter = {
    readTurnState: async (ref: SourceRef) => {
      seen.push(ref.updatedAtHint)
      return undefined
    },
  } as unknown as ProviderAdapter
  const internals = service as unknown as {
    turnSources: Map<string, { adapter: ProviderAdapter; ref: SourceRef }>
  }
  const entry = service.live.open({ terminalId: 't1', localixSessionId: 's', provider: 'codex' })
  service.live.adopt('t1', 'n1')
  ;(entry as { explain: LiveEntry['explain'] }).explain = { ...entry.explain, fallbackReason: 'x' }
  internals.turnSources.set('codex:n1', {
    adapter,
    ref: { nativeSessionId: 'n1', sourcePath: path, revision: '', updatedAtHint: 1 },
  })
  await utimes(path, new Date(), new Date(1_800_000_000_000))
  await service.readTurn(service.live.get('t1')!)
  expect(seen).toEqual([1_800_000_000_000])
  service.shutdown()
})
