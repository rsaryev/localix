import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { backendClient } from '@/shared/api/client'
import type { UiSession } from '@/shared/api/contracts'
import { composerBus } from '@/shared/lib/composerBus'
import { resetNotificationsForTests, useNotificationsStore } from '@/shared/lib/notifications/store'
import { useChatStore } from './store'

const session = (isRunning: boolean): UiSession =>
  ({
    id: 's1',
    projectId: 'PRJ-1',
    messages: [],
    isRunning,
    runtimeStatus: isRunning ? 'running' : 'idle',
    queuedMessages: [],
  }) as unknown as UiSession

let originalState: ReturnType<typeof useChatStore.getState>
let restoreStop: (() => void) | undefined
let restoreGet: (() => void) | undefined

beforeEach(() => {
  originalState = useChatStore.getState()
  const running = session(true)
  useChatStore.setState({
    sessions: [running],
    allSessions: [running],
    activeSessionId: running.id,
    activeProjectId: 'PRJ-1',
  })
})

afterEach(() => {
  restoreStop?.()
  restoreGet?.()
  restoreStop = undefined
  restoreGet = undefined
  useChatStore.setState(originalState, true)
})

describe('optimistic stop rollback', () => {
  test('a truthful no-op stays idle', async () => {
    const stopSpy = spyOn(backendClient, 'stop').mockResolvedValue({ stopped: false, returned: [] })
    restoreStop = () => stopSpy.mockRestore()

    useChatStore.getState().stopGeneration('s1')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useChatStore.getState().sessions[0]?.isRunning).toBe(false)
  })

  test('a rejected stop restores running state and reconciles from detail', async () => {
    const stopSpy = spyOn(backendClient, 'stop').mockRejectedValue(new Error('offline'))
    const getSpy = spyOn(backendClient, 'getSession').mockResolvedValue(session(true))
    restoreStop = () => stopSpy.mockRestore()
    restoreGet = () => getSpy.mockRestore()

    useChatStore.getState().stopGeneration('s1')
    expect(useChatStore.getState().sessions[0]?.isRunning).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useChatStore.getState().sessions[0]?.isRunning).toBe(true)
    expect(getSpy).toHaveBeenCalledWith('s1')
  })

  // The person pressed Stop; a Stop that never arrived used to leave the agent running in silence.
  test('a rejected stop is said, with a Retry that stops again', async () => {
    resetNotificationsForTests()
    const stopSpy = spyOn(backendClient, 'stop').mockRejectedValue(new Error('offline'))
    const getSpy = spyOn(backendClient, 'getSession').mockResolvedValue(session(true))
    restoreStop = () => stopSpy.mockRestore()
    restoreGet = () => getSpy.mockRestore()

    useChatStore.getState().stopGeneration('s1')
    await new Promise((resolve) => setTimeout(resolve, 0))

    const row = useNotificationsStore.getState().entries[0]
    expect(row).toMatchObject({ severity: 'error', title: 'Could not stop the agent' })
    const retry = row?.actions?.find((action) => action.label === 'Retry')
    expect(retry?.kind).toBe('callback')
    if (retry?.kind === 'callback') void retry.onClick?.()
    expect(stopSpy).toHaveBeenCalledTimes(2)
    resetNotificationsForTests()
  })

  test('a terminal stream event wins over a late failed-stop refetch', async () => {
    let rejectStop!: (error: Error) => void
    let resolveDetail!: (value: UiSession) => void
    const stopSpy = spyOn(backendClient, 'stop').mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectStop = reject
        }),
    )
    const getSpy = spyOn(backendClient, 'getSession').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDetail = resolve
        }),
    )
    restoreStop = () => stopSpy.mockRestore()
    restoreGet = () => getSpy.mockRestore()

    useChatStore.getState().stopGeneration('s1')
    rejectStop(new Error('connection lost'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    useChatStore.getState()._setSessionRunning('s1', false)
    const terminalGeneration = useChatStore.getState().sessions[0]
    resolveDetail(session(true))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useChatStore.getState().sessions[0]).toBe(terminalGeneration)
    expect(useChatStore.getState().sessions[0]?.isRunning).toBe(false)
  })

  // The stop reached the server and worked. A failure putting the queue back is a different
  // problem and must not roll the agent back to "running" or offer to stop it again.
  test('a stop that worked is not reported as failed when putting the queue back throws', async () => {
    resetNotificationsForTests()
    const stopSpy = spyOn(backendClient, 'stop').mockResolvedValue({
      stopped: true,
      returned: [{ content: 'queued', clientMessageId: 'c1' }],
    })
    restoreStop = () => stopSpy.mockRestore()
    useChatStore.setState({
      _discardReturnedQueue: () => {
        throw new Error('store broke')
      },
    })

    useChatStore.getState().stopGeneration('s1')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(useChatStore.getState().sessions[0]?.isRunning).toBe(false)
    const titles = useNotificationsStore.getState().entries.map((entry) => entry.title)
    expect(titles).not.toContain('Could not stop the agent')
    expect(titles).toContain('Could not put your queued messages back')
    resetNotificationsForTests()
    // The returned line is held for a composer of s1; take it so it cannot reach another test's.
    const off = composerBus.subscribe(() => true)
    await Promise.resolve()
    off()
  })
})
