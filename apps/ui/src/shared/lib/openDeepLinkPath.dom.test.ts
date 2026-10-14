import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { backendClient } from '@/shared/api/client'
import { registerInspectorHandler, type InspectorRequest } from './inspectorBus'
import { publishPageOpenChat } from './pageOpenChat'
import { openDeepLinkFile, openDeepLinkPath } from './openDeepLinkPath'
import { scopePath } from '@/shared/routing/routes'
import { __resetRuntimeReady, RUNTIME_STATUS_EVENT } from './runtimeReady'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(() => teardown())

describe('OS file opens', () => {
  test('a cold file waits for the shell to report that its service is ready', async () => {
    const resolve = spyOn(backendClient, 'resolveProjectByPath').mockResolvedValue({
      project: { id: 'project' } as Awaited<
        ReturnType<typeof backendClient.resolveProjectByPath>
      >['project'],
      filePath: '/data.json',
      created: false,
    })
    const received: InspectorRequest[] = []
    const unregister = registerInspectorHandler((request) => received.push(request))
    const withdraw = publishPageOpenChat('chat', 'project')
    const oldStatus = window.__LOCALIX_RUNTIME_STATUS
    const previousHash = window.location.hash
    window.__LOCALIX_RUNTIME_STATUS = 'starting'
    try {
      const pending = openDeepLinkPath('/data.json')
      await new Promise((done) => setTimeout(done, 0))
      expect(resolve).not.toHaveBeenCalled()
      window.__LOCALIX_RUNTIME_STATUS = 'ready'
      window.dispatchEvent(new CustomEvent(RUNTIME_STATUS_EVENT))
      await pending
      expect(resolve).toHaveBeenCalledTimes(1)
      expect(received).toHaveLength(1)
    } finally {
      if (oldStatus === undefined) delete window.__LOCALIX_RUNTIME_STATUS
      else window.__LOCALIX_RUNTIME_STATUS = oldStatus
      __resetRuntimeReady()
      resolve.mockRestore()
      withdraw()
      unregister()
      window.location.hash = previousHash
    }
  })

  test('cold launch retains the file until the destination chat is published', async () => {
    const received: InspectorRequest[] = []
    const unregister = registerInspectorHandler((request) => received.push(request))
    let withdraw = publishPageOpenChat(null)
    try {
      const pending = openDeepLinkFile('downloads', '/Downloads/data.json')
      expect(received).toEqual([])
      withdraw()
      withdraw = publishPageOpenChat('download-chat', 'downloads')
      await pending
      expect(received).toEqual([
        { kind: 'file', sessionId: 'download-chat', path: '/Downloads/data.json', solo: true },
      ])
    } finally {
      withdraw()
      unregister()
    }
  })

  test('a warm open waits for the new project instead of using the outgoing chat', async () => {
    const received: InspectorRequest[] = []
    const unregister = registerInspectorHandler((request) => received.push(request))
    let withdraw = publishPageOpenChat('old-chat', 'old-project')
    try {
      const pending = openDeepLinkFile('new-project', '/new/report.json')
      expect(received).toEqual([])
      withdraw()
      withdraw = publishPageOpenChat('new-chat', 'new-project')
      await pending
      expect(received[0]).toMatchObject({ sessionId: 'new-chat', path: '/new/report.json' })
    } finally {
      withdraw()
      unregister()
    }
  })

  test('chat readiness alone does not lose a file before the inspector mounts', async () => {
    const withdraw = publishPageOpenChat('chat', 'project')
    const received: InspectorRequest[] = []
    const pending = openDeepLinkFile('project', '/data.json')
    const unregister = registerInspectorHandler((request) => received.push(request))
    try {
      await pending
      expect(received).toHaveLength(1)
      publishPageOpenChat('chat', 'project')()
      expect(received).toHaveLength(1)
    } finally {
      withdraw()
      unregister()
    }
  })

  test('a ready destination opens immediately and preserves special characters', async () => {
    const received: InspectorRequest[] = []
    const unregister = registerInspectorHandler((request) => received.push(request))
    const withdraw = publishPageOpenChat('chat', 'project')
    const path = '/Downloads/\u0434\u0430\u043d\u043d\u044b\u0435 #100% + "sample".json'
    try {
      await openDeepLinkFile('project', path)
      await openDeepLinkFile('project', path)
      expect(received.map((request) => request.kind === 'file' && request.path)).toEqual([
        path,
        path,
      ])
    } finally {
      withdraw()
      unregister()
    }
  })

  test('a stalled destination rejects and releases its subscriptions', async () => {
    const received: InspectorRequest[] = []
    const unregister = registerInspectorHandler((request) => received.push(request))
    try {
      await expect(openDeepLinkFile('missing-project', '/data.json', 1)).rejects.toThrow(
        'The destination workspace did not become ready.',
      )
      publishPageOpenChat('late-chat', 'missing-project')()
      expect(received).toEqual([])
    } finally {
      unregister()
    }
  })

  test('path resolution navigates first and opens only after the target chat arrives', async () => {
    const resolve = spyOn(backendClient, 'resolveProjectByPath').mockResolvedValue({
      project: { id: 'downloads' } as Awaited<
        ReturnType<typeof backendClient.resolveProjectByPath>
      >['project'],
      filePath: '/Downloads/data.json',
      created: true,
    })
    const received: InspectorRequest[] = []
    const unregister = registerInspectorHandler((request) => received.push(request))
    let withdraw = publishPageOpenChat('old-chat', 'old-project')
    const previousHash = window.location.hash
    try {
      const pending = openDeepLinkPath('/Downloads/data.json')
      await new Promise((done) => setTimeout(done, 0))
      expect(window.location.hash).toBe(`#${scopePath('downloads')}`)
      expect(received).toEqual([])
      withdraw()
      withdraw = publishPageOpenChat('download-chat', 'downloads')
      await pending
      expect(resolve).toHaveBeenCalledWith('/Downloads/data.json')
      expect(received[0]).toMatchObject({ sessionId: 'download-chat' })
    } finally {
      resolve.mockRestore()
      withdraw()
      unregister()
      window.location.hash = previousHash
    }
  })

  test('a folder navigates without opening a file or requiring a chat', async () => {
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
      resolve.mockRestore()
      unregister()
      window.location.hash = previousHash
    }
  })
})
