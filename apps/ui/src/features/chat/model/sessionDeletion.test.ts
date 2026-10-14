import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { usePreviewStore } from '@/features/inspector/model/previewStore'
import { backendClient } from '@/shared/api/client'
import type { UiSession } from '@/shared/api/contracts'
import { registerInspectorHandler, type InspectorRequest } from '@/shared/lib/inspectorBus'
import { useChatStore } from './store'

const session = (id: string): UiSession =>
  ({
    id,
    title: id,
    projectId: null,
    messages: [],
    queuedMessages: [],
  }) as unknown as UiSession

let originalChatState: ReturnType<typeof useChatStore.getState>
let originalPreviewState: Pick<
  ReturnType<typeof usePreviewStore.getState>,
  'previewBySession' | 'previewTabsBySession'
>
let restoreDelete: (() => void) | undefined
let unregister: (() => void) | undefined

beforeEach(() => {
  originalChatState = useChatStore.getState()
  const previewState = usePreviewStore.getState()
  originalPreviewState = {
    previewBySession: previewState.previewBySession,
    previewTabsBySession: previewState.previewTabsBySession,
  }
  const sessions = [session('session-a'), session('session-b')]
  useChatStore.setState({
    sessions,
    allSessions: sessions,
    activeSessionId: 'session-a',
    activeProjectId: null,
  })
  usePreviewStore.setState({ previewBySession: {}, previewTabsBySession: {} })
})

afterEach(() => {
  restoreDelete?.()
  restoreDelete = undefined
  unregister?.()
  unregister = undefined
  useChatStore.setState(originalChatState, true)
  usePreviewStore.setState(originalPreviewState)
})

describe('session deletion teardown', () => {
  test("deleting a chat discards its Browser tabs and leaves another chat's open", async () => {
    const remove = spyOn(backendClient, 'deleteSession').mockResolvedValue(undefined)
    restoreDelete = () => remove.mockRestore()
    const calls: InspectorRequest[] = []
    unregister = registerInspectorHandler((request) => calls.push(request))
    usePreviewStore.getState().recordPreview('session-a', {
      previewId: 'preview-a',
      url: 'http://preview-a/',
      version: 1,
    })
    usePreviewStore.getState().recordPreview('session-b', {
      previewId: 'preview-b',
      url: 'http://preview-b/',
      version: 1,
    })

    await useChatStore.getState().deleteSession('session-a')

    expect(usePreviewStore.getState().previewBySession['session-a']).toBeUndefined()
    expect(usePreviewStore.getState().previewTabsBySession['session-a']).toBeUndefined()
    expect(
      usePreviewStore.getState().previewTabsBySession['session-b']?.map((tab) => tab.previewId),
    ).toEqual(['preview-b'])
    expect(calls).toEqual([{ kind: 'close-session', sessionId: 'session-a' }])

    calls.length = 0
    await useChatStore.getState().deleteSession('session-b')

    expect(usePreviewStore.getState().previewTabsBySession).toEqual({})
    expect(calls.at(-1)).toEqual({ kind: 'close-session', sessionId: 'session-b' })
  })

  test('deleting a chat closes the native pages behind its tabs, and no other chat’s', async () => {
    // Unmounting a page only hides its layer, so a deleted chat's pages kept running unseen.
    const remove = spyOn(backendClient, 'deleteSession').mockResolvedValue(undefined)
    restoreDelete = () => remove.mockRestore()
    const invoked: unknown[] = []
    const host = globalThis as { window?: unknown }
    const hadWindow = 'window' in host
    host.window ??= {}
    ;(host.window as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: async (command: string, args: unknown) => void invoked.push([command, args]),
      },
    }
    try {
      for (const [sessionId, previewId] of [
        ['session-a', 'page-a1'],
        ['session-a', 'page-a2'],
        ['session-b', 'page-b'],
      ] as const)
        usePreviewStore
          .getState()
          .recordPreview(sessionId, { previewId, url: `http://${previewId}/`, version: 1 })

      await useChatStore.getState().deleteSession('session-a')

      expect(invoked).toEqual([
        [
          'browser_close_many',
          {
            tabIds: ['page-a1', 'page-a2'],
            leases: { 'page-a1': expect.any(String), 'page-a2': expect.any(String) },
          },
        ],
      ])
    } finally {
      if (hadWindow) delete (host.window as { __TAURI__?: unknown }).__TAURI__
      else delete host.window
    }
  })
})
