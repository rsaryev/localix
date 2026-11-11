import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { emptyEditorState, useGridStore } from '@/entities/workspace-grid/model'
import { backendClient } from '@/shared/api/client'
import type { Project, UiSession } from '@/shared/api/contracts'
import { useChatStore } from '@/entities/chat/model/store'
import { restartTerminalTab } from './terminalTabs'

const original = useGridStore.getState()
let restore: (() => void) | undefined
beforeEach(() => {
  useGridStore.setState(emptyEditorState('test-group'))
  useGridStore.getState().openItem({
    id: 'terminal:failed',
    kind: 'terminal',
    title: 'Build',
    scope: 's1',
    payload: {
      sessionId: 's1',
      terminalId: 'failed',
      owned: false,
      terminalExit: { exitCode: 1, command: 'bun build', cwd: '/work/frontend' },
    },
  })
})
afterEach(() => {
  restore?.()
  restore = undefined
  useGridStore.setState(original)
})

test('a failed restart leaves the error tab and its status intact', async () => {
  const spawn = spyOn(backendClient, 'spawnTerminalCommand').mockRejectedValue(new Error('offline'))
  restore = () => spawn.mockRestore()
  expect(await restartTerminalTab('terminal:failed')).toBe(false)
  expect(useGridStore.getState().items['terminal:failed']?.payload?.terminalExit).toMatchObject({
    exitCode: 1,
  })
})

test('restarts the same command and only replaces the old tab after spawn succeeds', async () => {
  let answer!: (value: { terminalId: string }) => void
  const spawn = spyOn(backendClient, 'spawnTerminalCommand').mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve
      }),
  )
  restore = () => spawn.mockRestore()
  const pending = restartTerminalTab('terminal:failed')
  expect(useGridStore.getState().items['terminal:failed']).toBeDefined()
  answer({ terminalId: 'replacement' })
  expect(await pending).toBe(true)
  expect(spawn).toHaveBeenCalledWith({
    sessionId: 's1',
    command: 'bun build',
    cwd: '/work/frontend',
  })
  expect(useGridStore.getState().items['terminal:failed']).toBeUndefined()
  expect(useGridStore.getState().items['terminal:replacement']?.payload).toMatchObject({
    owned: true,
    command: 'bun build',
  })
  expect(
    useGridStore.getState().items['terminal:replacement']?.payload?.terminalExit,
  ).toBeUndefined()
})

test('restarting an interactive shell creates a fresh shell in the same session', async () => {
  const item = useGridStore.getState().items['terminal:failed']!
  useGridStore.setState({
    items: {
      [item.id]: {
        ...item,
        payload: {
          ...item.payload,
          terminalExit: { exitCode: 2, interactive: true },
        },
      },
    },
  })
  const request = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ id: 'new-shell', cwd: '/workspace', createdAt: 1 }),
  )
  restore = () => request.mockRestore()
  expect(await restartTerminalTab(item.id)).toBe(true)
  const init = request.mock.calls[0]?.[1]
  expect(typeof init?.body).toBe('string')
  expect(JSON.parse(init!.body as string)).toEqual({ sessionId: 's1' })
  expect(useGridStore.getState().items['terminal:new-shell']?.payload?.terminalExit).toBeUndefined()
})

test('closing the original tab while spawning disposes the replacement', async () => {
  let answer!: (value: { terminalId: string }) => void
  const spawn = spyOn(backendClient, 'spawnTerminalCommand').mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve
      }),
  )
  const request = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }))
  restore = () => {
    spawn.mockRestore()
    request.mockRestore()
  }
  const pending = restartTerminalTab('terminal:failed')
  const grid = useGridStore.getState()
  grid.closeTab(grid.activeGroup, 'terminal:failed')
  answer({ terminalId: 'orphan' })
  expect(await pending).toBe(false)
  expect(request.mock.calls[0]?.[1]?.method).toBe('DELETE')
  expect(useGridStore.getState().items['terminal:orphan']).toBeUndefined()
})

test('a shell whose project moved restarts at the same place in the new folder, and the old tab goes', async () => {
  const chat = useChatStore.getState()
  useChatStore.setState({
    allSessions: [{ id: 's1', projectId: 'PRJ-1' } as unknown as UiSession],
    projects: [{ id: 'PRJ-1', workingDir: '/work/llx' } as unknown as Project],
  })
  useGridStore.getState().openItem({
    id: 'terminal:live',
    kind: 'terminal',
    title: 'Terminal',
    scope: 's1',
    payload: {
      sessionId: 's1',
      terminalId: 'live',
      owned: true,
      cwd: '/work/kit/app',
      projectDir: '/work/kit',
    },
  })
  const request = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ id: 'moved-shell', cwd: '/work/llx/app', createdAt: 1 }),
  )
  restore = () => {
    request.mockRestore()
    useChatStore.setState(chat)
  }
  expect(await restartTerminalTab('terminal:live')).toBe(true)
  expect(JSON.parse(request.mock.calls[0]?.[1]?.body as string)).toEqual({
    sessionId: 's1',
    cwd: '/work/llx/app',
  })
  expect(useGridStore.getState().items['terminal:live']).toBeUndefined()
  expect(useGridStore.getState().items['terminal:moved-shell']?.payload).toMatchObject({
    cwd: '/work/llx/app',
    projectDir: '/work/llx',
  })
})
