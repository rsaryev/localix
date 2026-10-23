import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing'
import {
  bindMiniAppUiRuntime,
  type MiniAppUiRuntime,
  type MiniAppSession,
  type MiniAppWorkspaceWatchHandlers,
} from '@localixai/mini-app-sdk/ui/runtime'
import { useSourceControlStore } from '../source-control/model/store'
import { CHANGE_WINDOW_MS } from '../source-control/model/useGitPoller'
import { GitPoller } from './GitPoller'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

test('polls the chat it is mounted for and retries negative probes, project changes, and run completion', async () => {
  const { createRoot } = await import('react-dom/client')
  let sessions = [{ id: 's1', projectId: 'p1', isRunning: false }] as MiniAppSession[]
  const listeners = new Set<() => void>()
  // No `activeId` here: the runtime no longer has one, and the poller must not need it.
  const unbind = bindMiniAppUiRuntime({
    sessions: {
      list: () => sessions,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  } as unknown as MiniAppUiRuntime)
  const original = useSourceControlStore.getState()
  const refresh = spyOn(original, 'refresh').mockResolvedValue(undefined)
  const fresh = spyOn(original, 'refreshFresh').mockResolvedValue(undefined)
  const intervals: number[] = []
  const ticks: Array<() => void> = []
  const nativeInterval = globalThis.setInterval
  const captureInterval = (handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    intervals.push(delay ?? 0)
    if (typeof handler === 'function') ticks.push(() => handler(...args))
    return nativeInterval(() => {}, 60_000)
  }
  const timer = spyOn(globalThis, 'setInterval').mockImplementation(
    captureInterval as unknown as typeof globalThis.setInterval,
  )
  const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => root.render(<GitPoller sessionId="s1" />))
    expect(fresh).toHaveBeenCalledWith('s1')
    expect(intervals.at(-1)).toBe(6000)
    await act(async () => {
      useSourceControlStore.setState({
        bySession: {
          s1: {
            status: {
              isRepo: false,
              vcs: null,
              root: null,
              branch: null,
              detached: false,
              upstream: null,
              ahead: 0,
              behind: 0,
              files: [],
              stats: { files: 0, insertions: 0, deletions: 0 },
            },
            branches: null,
            stashes: [],
            repos: [],
            activeRepo: null,
            loading: false,
            error: null,
          },
        },
      })
    })
    expect(intervals.at(-1)).toBe(30_000)
    refresh.mockClear()
    await act(async () => ticks.at(-1)!())
    expect(refresh).toHaveBeenCalledWith('s1')
    refresh.mockClear()
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(refresh).toHaveBeenCalledWith('s1')
    fresh.mockClear()
    await act(async () => {
      sessions = [{ ...sessions[0]!, projectId: 'p2' }]
      for (const listener of listeners) listener()
    })
    expect(fresh).toHaveBeenCalledWith('s1')
    await act(async () => {
      sessions = [{ ...sessions[0]!, isRunning: true }]
      for (const listener of listeners) listener()
    })
    expect(intervals.at(-1)).toBe(6000)
    refresh.mockClear()
    await act(async () => {
      sessions = [{ ...sessions[0]!, isRunning: false }]
      for (const listener of listeners) listener()
    })
    expect(refresh).toHaveBeenCalledWith('s1')
  } finally {
    await act(async () => root.unmount())
    refresh.mockRestore()
    fresh.mockRestore()
    timer.mockRestore()
    if (visibility) Object.defineProperty(document, 'visibilityState', visibility)
    else Reflect.deleteProperty(document, 'visibilityState')
    useSourceControlStore.setState(original, true)
    unbind()
  }
})

/**
 * A `git switch` in the terminal reached the branch pill up to 30 s late, because a timer was the
 * only thing that asked git again. With the workspace signal live, a change drives the read and the
 * timer falls back to a two-minute backstop; a hidden surface defers its read until it shows.
 */
test('a live workspace signal drives the refresh and relaxes the timer to a backstop', async () => {
  const { createRoot } = await import('react-dom/client')
  const sessions = [{ id: 's1', projectId: 'p1', isRunning: false }] as MiniAppSession[]
  let handlers: MiniAppWorkspaceWatchHandlers | null = null
  const unbind = bindMiniAppUiRuntime({
    sessions: { list: () => sessions, subscribe: () => () => {} },
    files: {
      watchWorkspace: (sessionId: string, next: MiniAppWorkspaceWatchHandlers) => {
        expect(sessionId).toBe('s1')
        handlers = next
        return () => {
          handlers = null
        }
      },
    },
  } as unknown as MiniAppUiRuntime)
  const original = useSourceControlStore.getState()
  const refresh = spyOn(original, 'refresh').mockResolvedValue(undefined)
  const fresh = spyOn(original, 'refreshFresh').mockResolvedValue(undefined)
  const intervals: number[] = []
  const nativeInterval = globalThis.setInterval
  const timer = spyOn(globalThis, 'setInterval').mockImplementation(((
    _handler: TimerHandler,
    delay?: number,
  ) => {
    intervals.push(delay ?? 0)
    return nativeInterval(() => {}, 60_000)
  }) as unknown as typeof globalThis.setInterval)
  // The change window is real time; fold it to zero so the test does not sleep through it.
  const nativeTimeout = globalThis.setTimeout
  const timeout = spyOn(globalThis, 'setTimeout').mockImplementation(((
    handler: TimerHandler,
    delay?: number,
    ...args: unknown[]
  ) =>
    nativeTimeout(
      handler as () => void,
      delay === CHANGE_WINDOW_MS ? 0 : delay,
      ...args,
    )) as unknown as typeof globalThis.setTimeout)
  const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
  const hidden = Object.getOwnPropertyDescriptor(document, 'hidden')
  const setVisible = (visible: boolean) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: visible ? 'visible' : 'hidden',
    })
    Object.defineProperty(document, 'hidden', { configurable: true, value: !visible })
  }
  setVisible(true)
  const settle = () => act(async () => new Promise((resolve) => nativeTimeout(resolve, 5)))
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => root.render(<GitPoller sessionId="s1" />))
    expect(fresh).toHaveBeenCalledWith('s1')
    // A settled probe: a pending one keeps the brisk startup cadence whatever the signal says.
    await act(async () => {
      useSourceControlStore.setState({
        bySession: {
          s1: {
            status: {
              isRepo: true,
              vcs: 'git',
              root: '/w',
              branch: 'main',
              detached: false,
              upstream: null,
              ahead: 0,
              behind: 0,
              files: [],
              stats: { files: 0, insertions: 0, deletions: 0 },
            },
            branches: null,
            stashes: [],
            repos: [],
            activeRepo: null,
            loading: false,
            error: null,
          },
        },
      })
    })
    await act(async () => handlers!.onLive(true))
    expect(intervals.at(-1)).toBe(120_000)

    refresh.mockClear()
    await act(async () => handlers!.onChange(['/w/.git/HEAD', '/w/.git']))
    await settle()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith('s1')

    // Hidden: the change is remembered, not read; showing the surface again reads it once.
    refresh.mockClear()
    setVisible(false)
    await act(async () => handlers!.onChange(['/w/src/a.ts']))
    await settle()
    expect(refresh).not.toHaveBeenCalled()
    setVisible(true)
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(refresh).toHaveBeenCalledWith('s1')

    // The signal going away (a remote session, a failed watcher) restores the idle cadence.
    await act(async () => handlers!.onLive(false))
    expect(intervals.at(-1)).toBe(30_000)
  } finally {
    await act(async () => root.unmount())
    expect(handlers).toBeNull()
    refresh.mockRestore()
    fresh.mockRestore()
    timer.mockRestore()
    timeout.mockRestore()
    if (visibility) Object.defineProperty(document, 'visibilityState', visibility)
    else Reflect.deleteProperty(document, 'visibilityState')
    if (hidden) Object.defineProperty(document, 'hidden', hidden)
    else Reflect.deleteProperty(document, 'hidden')
    useSourceControlStore.setState(original, true)
    unbind()
  }
})

test('a mount without a chat reads no repository — there is no session to guess', async () => {
  const { createRoot } = await import('react-dom/client')
  const sessions = [{ id: 's1', projectId: 'p1', isRunning: true }] as MiniAppSession[]
  const unbind = bindMiniAppUiRuntime({
    sessions: { list: () => sessions, subscribe: () => () => {} },
  } as unknown as MiniAppUiRuntime)
  const original = useSourceControlStore.getState()
  const refresh = spyOn(original, 'refresh').mockResolvedValue(undefined)
  const fresh = spyOn(original, 'refreshFresh').mockResolvedValue(undefined)
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => root.render(<GitPoller sessionId={null} />))
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(fresh).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    refresh.mockRestore()
    fresh.mockRestore()
    useSourceControlStore.setState(original, true)
    unbind()
  }
})
