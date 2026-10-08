import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  emptyEditorState,
  groupOfTab,
  useGridStore,
  type WorkItem,
} from '@/features/workspace-grid/model'
import { backendClient } from '@/shared/api/client'
import { DEAD_TERMINAL_RETENTION_MS, finishTerminalTabs } from './deadTerminalTabs'
import { startTerminalExpiry } from './terminalExpiry'
import { restartTerminalTab } from './terminalTabs'
import { workItemTransferState } from '@/shared/lib/workItemTransferState'

const original = useGridStore.getState()
let stop: (() => void) | undefined
const restore: Array<() => void> = []
beforeEach(() => useGridStore.setState({ ...emptyEditorState('root'), scopeActiveTab: {} }))
afterEach(() => {
  stop?.()
  stop = undefined
  for (const cleanup of restore.splice(0)) cleanup()
  useGridStore.setState(original)
})

function clock(start = 1_000) {
  let now = start
  let sequence = 0
  const timers = new Map<number, { at: number; task: () => void }>()
  return {
    now: () => now,
    schedule(task: () => void, ms: number) {
      const id = ++sequence
      timers.set(id, { at: now + ms, task })
      return () => void timers.delete(id)
    },
    pending: () => timers.size,
    advance(ms: number) {
      const end = now + ms
      let turns = 0
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        if (++turns > 100) throw new Error('Expiry scheduled a recurring immediate timer')
        timers.delete(due[0])
        now = due[1].at
        due[1].task()
      }
      now = end
    },
  }
}

function open(id: string, payload: Record<string, unknown> = {}, scope = 'visible'): WorkItem {
  const item: WorkItem = {
    id: `terminal:${id}`,
    kind: 'terminal',
    title: id,
    scope,
    payload: { terminalId: id, sessionId: scope, owned: false, ...payload },
  }
  useGridStore.getState().openItem(item)
  return useGridStore.getState().items[item.id]!
}

function close(id: string) {
  const grid = useGridStore.getState()
  const group = groupOfTab(grid.root, `terminal:${id}`)!
  grid.closeTab(group.id, `terminal:${id}`)
}

test('dead tabs in hidden conversations and reopen history expire at 60 seconds; live tabs survive', () => {
  const time = clock()
  open('live')
  open('hidden', {}, 'hidden')
  open('closed')
  close('closed')
  finishTerminalTabs('hidden', { exitCode: 1 }, time.now())
  finishTerminalTabs('closed', { exitCode: 0, command: 'bun build' }, time.now())
  stop = startTerminalExpiry(time)
  time.advance(DEAD_TERMINAL_RETENTION_MS - 1)
  expect(useGridStore.getState().items['terminal:hidden']).toBeDefined()
  expect(useGridStore.getState().closed).toHaveLength(1)
  time.advance(1)
  expect(Object.keys(useGridStore.getState().items)).toEqual(['terminal:live'])
  expect(useGridStore.getState().closed).toEqual([])
  expect(time.pending()).toBe(0)
})

test('an expired source stays available during a window handoff and resumes cleanup after failure', () => {
  const time = clock()
  const item = open('moving')
  finishTerminalTabs('moving', { exitCode: 1 }, time.now())
  stop = startTerminalExpiry(time)
  workItemTransferState.begin(item.id)
  try {
    time.advance(DEAD_TERMINAL_RETENTION_MS + 10_000)
    expect(useGridStore.getState().items[item.id]).toBeDefined()
    expect(time.pending()).toBe(0)
    workItemTransferState.finish(item.id)
    time.advance(0)
    expect(useGridStore.getState().items[item.id]).toBeUndefined()
    expect(time.pending()).toBe(0)
  } finally {
    workItemTransferState.finish(item.id)
  }
})

test('duplicate stream and poll observations keep the first deadline and the confirmed failure', () => {
  const time = clock()
  open('dead')
  finishTerminalTabs('dead', { exitCode: 1 }, time.now())
  stop = startTerminalExpiry(time)
  time.advance(30_000)
  finishTerminalTabs('dead', { exitCode: 1, command: 'bun test' }, time.now())
  finishTerminalTabs('dead', { exitCode: null }, time.now())
  finishTerminalTabs('dead', { exitCode: 0, interactive: true }, time.now())
  expect(useGridStore.getState().items['terminal:dead']?.payload?.terminalExit).toEqual({
    exitCode: 1,
    command: 'bun test',
  })
  time.advance(30_000)
  expect(useGridStore.getState().items['terminal:dead']).toBeUndefined()
})

test('older dead tabs restored after the expiry service starts receive a deadline', () => {
  const time = clock()
  stop = startTerminalExpiry(time)
  time.advance(10_000)
  open('restored', { terminalExit: { exitCode: null } })
  expect(useGridStore.getState().items['terminal:restored']?.payload?.terminalExpiresAt).toBe(
    time.now() + DEAD_TERMINAL_RETENTION_MS,
  )
  time.advance(DEAD_TERMINAL_RETENTION_MS)
  expect(useGridStore.getState().items['terminal:restored']).toBeUndefined()
})

test('older dead tabs in the closed history receive a deadline and cannot be reopened after expiry', () => {
  const time = clock()
  open('old-history', { terminalExit: { exitCode: 1 } })
  close('old-history')
  stop = startTerminalExpiry(time)
  expect(useGridStore.getState().closed[0]?.item.payload?.terminalExpiresAt).toBe(
    time.now() + DEAD_TERMINAL_RETENTION_MS,
  )
  time.advance(DEAD_TERMINAL_RETENTION_MS)
  useGridStore.getState().reopenClosedTab()
  expect(useGridStore.getState().items['terminal:old-history']).toBeUndefined()
})

test('invalid persisted deadlines are repaired while malformed terminal records do not schedule', () => {
  const time = clock()
  open('invalid', { terminalExit: { exitCode: 1 }, terminalExpiresAt: 'yesterday' })
  open('malformed', { terminalId: null, terminalExit: { exitCode: 1 }, terminalExpiresAt: 0 })
  stop = startTerminalExpiry(time)
  time.advance(DEAD_TERMINAL_RETENTION_MS)
  expect(useGridStore.getState().items['terminal:invalid']).toBeUndefined()
  expect(time.pending()).toBe(0)
})

test('stopping the expiry service cancels its pending timer', () => {
  const time = clock()
  open('dead')
  finishTerminalTabs('dead', { exitCode: 1 }, time.now())
  const cancel = startTerminalExpiry(time)
  expect(time.pending()).toBe(1)
  cancel()
  time.advance(DEAD_TERMINAL_RETENTION_MS)
  expect(useGridStore.getState().items['terminal:dead']).toBeDefined()
  expect(time.pending()).toBe(0)
})

test('a pending restart survives its old deadline and retires the original reopen entry on success', async () => {
  const time = clock()
  let answer!: (value: { terminalId: string }) => void
  const spawn = spyOn(backendClient, 'spawnTerminalCommand').mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve
      }),
  )
  restore.push(() => spawn.mockRestore())
  open('original', { command: 'bun build' })
  finishTerminalTabs('original', { exitCode: 1, command: 'bun build' }, time.now())
  stop = startTerminalExpiry(time)
  const restart = restartTerminalTab('terminal:original')
  expect(await restartTerminalTab('terminal:original')).toBe(false)
  expect(spawn).toHaveBeenCalledTimes(1)
  time.advance(DEAD_TERMINAL_RETENTION_MS)
  expect(useGridStore.getState().items['terminal:original']).toBeDefined()
  answer({ terminalId: 'replacement' })
  expect(await restart).toBe(true)
  expect(
    useGridStore.getState().closed.some((entry) => entry.item.id === 'terminal:original'),
  ).toBe(false)
  expect(useGridStore.getState().items['terminal:replacement']).toBeDefined()
})

test('closing a source during failed restart clears the history flag and allows eventual expiry', async () => {
  const time = clock()
  const now = spyOn(Date, 'now').mockImplementation(time.now)
  let reject!: (reason: Error) => void
  const spawn = spyOn(backendClient, 'spawnTerminalCommand').mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      }),
  )
  restore.push(
    () => now.mockRestore(),
    () => spawn.mockRestore(),
  )
  open('original', { command: 'bun build' })
  finishTerminalTabs('original', { exitCode: 1, command: 'bun build' }, time.now())
  stop = startTerminalExpiry(time)
  const restart = restartTerminalTab('terminal:original')
  close('original')
  time.advance(DEAD_TERMINAL_RETENTION_MS)
  reject(new Error('offline'))
  expect(await restart).toBe(false)
  expect(useGridStore.getState().closed[0]?.item.payload?.terminalRestarting).toBe(false)
  time.advance(DEAD_TERMINAL_RETENTION_MS)
  expect(useGridStore.getState().closed).toEqual([])
})

test('a malformed terminal cannot spawn a replacement without a source identity', async () => {
  const spawn = spyOn(backendClient, 'spawnTerminalCommand')
  restore.push(() => spawn.mockRestore())
  open('malformed', { terminalId: null, command: 'bun build', terminalExit: { exitCode: 1 } })
  expect(await restartTerminalTab('terminal:malformed')).toBe(false)
  expect(spawn).not.toHaveBeenCalled()
})
