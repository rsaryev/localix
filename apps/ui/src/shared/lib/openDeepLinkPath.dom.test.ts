import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { backendClient } from '@/shared/api/client'
import { ApiError } from '@/shared/api/failure'
import { registerInspectorHandler, type InspectorRequest } from './inspectorBus'
import { publishPageOpenChat } from './pageOpenChat'
import { openDeepLinkPath } from './openDeepLinkPath'
import { scopePath } from '@/shared/routing/routes'
import { __resetRuntimeReady, RUNTIME_STATUS_EVENT } from './runtimeReady'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(() => teardown())

describe('OS file opens', () => {
  test('a cold file waits for the shell to report that its service is ready', async () => {
    const inspect = spyOn(backendClient, 'inspectPath').mockResolvedValue({
      kind: 'file',
      path: '/data.json',
    })
    const resolve = spyOn(backendClient, 'resolveProjectByPath')
    const received: InspectorRequest[] = []
    const unregister = registerInspectorHandler((request) => received.push(request))
    const withdraw = publishPageOpenChat('chat')
    const oldStatus = window.__LOCALIX_RUNTIME_STATUS
    window.__LOCALIX_RUNTIME_STATUS = 'starting'
    try {
      const pending = openDeepLinkPath('/data.json')
      await new Promise((done) => setTimeout(done, 0))
      expect(inspect).not.toHaveBeenCalled()
      window.__LOCALIX_RUNTIME_STATUS = 'ready'
      window.dispatchEvent(new CustomEvent(RUNTIME_STATUS_EVENT))
      await pending
      expect(inspect).toHaveBeenCalledTimes(1)
      expect(received).toHaveLength(1)
    } finally {
      if (oldStatus === undefined) delete window.__LOCALIX_RUNTIME_STATUS
      else window.__LOCALIX_RUNTIME_STATUS = oldStatus
      __resetRuntimeReady()
      inspect.mockRestore()
      resolve.mockRestore()
      withdraw()
      unregister()
    }
  })

  test('a file opens in the chat on screen and never creates or switches a project', async () => {
    const inspect = spyOn(backendClient, 'inspectPath').mockResolvedValue({
      kind: 'file',
      path: '/Downloads/data.json',
    })
    const resolve = spyOn(backendClient, 'resolveProjectByPath')
    const received: InspectorRequest[] = []
    const unregister = registerInspectorHandler((request) => received.push(request))
    const withdraw = publishPageOpenChat('current-chat')
    const previousHash = window.location.hash
    window.location.hash = `#${scopePath('current-project')}`
    try {
      await openDeepLinkPath('/Downloads/data.json')
      expect(resolve).not.toHaveBeenCalled()
      expect(window.location.hash).toBe(`#${scopePath('current-project')}`)
      expect(received).toEqual([
        { kind: 'file', sessionId: 'current-chat', path: '/Downloads/data.json' },
      ])
    } finally {
      inspect.mockRestore()
      resolve.mockRestore()
      withdraw()
      unregister()
      window.location.hash = previousHash
    }
  })

  test('a folder navigates without opening a file or requiring a chat', async () => {
    const inspect = spyOn(backendClient, 'inspectPath').mockResolvedValue({
      kind: 'directory',
      path: '/folder',
    })
    const resolve = spyOn(backendClient, 'resolveProjectByPath').mockResolvedValue({
      project: { id: 'folder' } as Awaited<
        ReturnType<typeof backendClient.resolveProjectByPath>
      >['project'],
      filePath: null,
      created: false,
    })
    const open = mock((_request: InspectorRequest) => {})
    const unregister = registerInspectorHandler(open)
    const previousHash = window.location.hash
    try {
      await openDeepLinkPath('/folder')
      expect(window.location.hash).toBe(`#${scopePath('folder')}`)
      expect(open).not.toHaveBeenCalled()
    } finally {
      inspect.mockRestore()
      resolve.mockRestore()
      unregister()
      window.location.hash = previousHash
    }
  })

  test('a missing file fails at once: no retry, no project, no tab', async () => {
    const inspect = spyOn(backendClient, 'inspectPath').mockRejectedValue(
      new ApiError('Path does not exist or cannot be read', 404, 'project_path_not_found'),
    )
    const resolve = spyOn(backendClient, 'resolveProjectByPath')
    const open = mock((_request: InspectorRequest) => {})
    const unregister = registerInspectorHandler(open)
    const withdraw = publishPageOpenChat('chat')
    try {
      await openDeepLinkPath('/Downloads/gone.pdf')
      expect(inspect).toHaveBeenCalledTimes(1)
      expect(resolve).not.toHaveBeenCalled()
      expect(open).not.toHaveBeenCalled()
    } finally {
      inspect.mockRestore()
      resolve.mockRestore()
      withdraw()
      unregister()
    }
  })
})
