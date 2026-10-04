import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { setWorkspaceResolver } from '@/shared/lib/workspaceOf'

import { usePreviewStore } from '@/features/inspector/model/previewStore'
import { registerInspectorHandler, type InspectorRequest } from '@/shared/lib/inspectorBus'
import {
  routeFsDocumentsOpened,
  routePreviewClosed,
  routePreviewUpdated,
  routeTerminalOpened,
} from './sessionEventRouters'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import { useLiveTerminalsStore } from '@/features/terminal/model/liveTerminals'
import { registerDedicatedViewerTypes } from '@/shared/lib/contentTypeRouting'
import { useChatStore } from './store'
import { previewHostKey, usePreviewHosts } from '@/features/inspector/model/previewHosts'

let unregister: (() => void) | undefined

afterEach(() => {
  unregister?.()
  unregister = undefined
  usePreviewStore.setState({ previewBySession: {}, previewTabsBySession: {} })
  useChatStore.setState({ activeSessionId: null })
})

const preview = (previewId: string) => ({
  previewId,
  url: `http://${previewId}/`,
  version: 1,
})

describe('preview close routing', () => {
  test('child completion releases background hosts but preserves user-opened previews', () => {
    for (const previewId of ['agent-only', 'user-opened']) {
      routePreviewUpdated('child-cleanup', {
        type: 'preview.updated',
        sessionId: 'child-cleanup',
        ...preview(previewId),
        background: true,
      })
    }
    const store = usePreviewStore.getState()
    store.recordPreview('child-cleanup', { ...preview('user-opened'), userOpened: true })
    store.setPreviewViewport('child-cleanup', 'user-opened', { width: 375, height: 667 })
    routePreviewUpdated('child-cleanup', {
      type: 'preview.updated',
      sessionId: 'child-cleanup',
      ...preview('user-opened'),
      version: 2,
      background: true,
    })
    routePreviewClosed('child-cleanup', {
      type: 'preview.closed',
      sessionId: 'child-cleanup',
      backgroundOnly: true,
    })
    expect(usePreviewStore.getState().previewTabsBySession['child-cleanup']).toHaveLength(1)
    expect(usePreviewStore.getState().previewBySession['child-cleanup']).toMatchObject({
      previewId: 'user-opened',
      userOpened: true,
      viewport: { width: 375, height: 667 },
    })
    expect(
      usePreviewHosts.getState().live[previewHostKey('child-cleanup', 'agent-only')],
    ).toBeUndefined()
    expect(usePreviewHosts.getState().live[previewHostKey('child-cleanup', 'user-opened')]).toBe(
      true,
    )
  })
  test("closing one chat's preview leaves another chat's Browser and its tab alone", () => {
    const calls: InspectorRequest[] = []
    unregister = registerInspectorHandler((request) => calls.push(request))
    usePreviewStore.getState().recordPreview('session-a', preview('preview-a'))
    usePreviewStore.getState().recordPreview('session-b', preview('preview-b'))

    routePreviewClosed('session-a', {
      type: 'preview.closed',
      sessionId: 'session-a',
      previewId: 'preview-a',
    })

    expect(usePreviewStore.getState().previewTabsBySession['session-a']).toEqual([])
    expect(
      usePreviewStore.getState().previewTabsBySession['session-b']?.map((tab) => tab.previewId),
    ).toEqual(['preview-b'])
    expect(calls).toEqual([])

    routePreviewClosed('session-b', {
      type: 'preview.closed',
      sessionId: 'session-b',
      previewId: 'preview-b',
    })

    expect(usePreviewStore.getState().previewTabsBySession['session-b']).toEqual([])
    expect(calls).toEqual([])
  })

  test("an agent's close never reaches another chat's Browser, even naming its tab id", () => {
    // Each chat has its own Browser strip and an agent only sees its own; scanning every chat's
    // strip let one chat's agent close another chat's page by id.
    usePreviewStore.getState().recordPreview('session-a', preview('a-tab'))
    routePreviewClosed('session-b', {
      type: 'preview.closed',
      sessionId: 'session-b',
      previewId: 'a-tab',
    })
    expect(
      usePreviewStore.getState().previewTabsBySession['session-a']?.map((tab) => tab.previewId),
    ).toEqual(['a-tab'])
  })

  test('one event closes the selected tabs of its own chat and nothing in the others', () => {
    const store = usePreviewStore.getState()
    store.recordPreview('session-a', preview('tab-a'))
    store.recordPreview('session-a', preview('tab-a2'))
    store.recordPreview('session-b', preview('tab-b'))
    routePreviewClosed('session-a', {
      type: 'preview.closed',
      sessionId: 'session-a',
      previewIds: ['tab-a', 'tab-b'],
    })
    const { previewTabsBySession } = usePreviewStore.getState()
    expect(previewTabsBySession['session-a']?.map((tab) => tab.previewId)).toEqual(['tab-a2'])
    expect(previewTabsBySession['session-b']?.map((tab) => tab.previewId)).toEqual(['tab-b'])
  })

  test('a background preview is retained without focusing the active session onto the wrong body', () => {
    const calls: InspectorRequest[] = []
    unregister = registerInspectorHandler((request) => calls.push(request), {
      isOpen: () => false,
    })
    useChatStore.setState({ activeSessionId: 'session-a' })

    routePreviewUpdated('session-b', {
      type: 'preview.updated',
      sessionId: 'session-b',
      previewId: 'background-preview',
      url: 'http://background-preview/',
      version: 1,
    })

    // Recorded in session B's own Browser, where it waits for B to be opened.
    expect(usePreviewStore.getState().previewTabsBySession['session-b']).toHaveLength(1)
    expect(usePreviewStore.getState().previewTabsBySession['session-a']).toBeUndefined()
    expect(calls).toEqual([])

    routePreviewUpdated('session-a', {
      type: 'preview.updated',
      sessionId: 'session-a',
      previewId: 'active-preview',
      url: 'http://active-preview/',
      version: 1,
    })

    expect(calls).toEqual([
      {
        kind: 'preview',
        sessionId: 'session-a',
        previewId: 'active-preview',
        url: 'http://active-preview/',
        version: 1,
        title: undefined,
        servedFile: undefined,
        rootDir: undefined,
        startCommand: undefined,
        frameBlocked: undefined,
      },
    ])
  })
})

describe('a sub-session’s pages live in its root’s Browser', () => {
  beforeEach(() => setWorkspaceResolver((id) => (id.startsWith('sub-') ? 'root' : null)))
  afterEach(() => setWorkspaceResolver(() => null))

  test('its page joins the root strip, and its cleanup closes only what it opened', () => {
    // The strip was keyed by the session itself: a sub-agent's page sat in a strip no Browser of
    // its parent showed, and a strip-wide close of a sub-session would now reach its parent's.
    routePreviewUpdated('root', { type: 'preview.updated', sessionId: 'root', ...preview('mine') })
    routePreviewUpdated('sub-1', {
      type: 'preview.updated',
      sessionId: 'sub-1',
      ...preview('sub-page'),
      background: true,
    })
    const strip = () =>
      usePreviewStore.getState().previewTabsBySession['root']?.map((tab) => tab.previewId)
    expect(strip()).toEqual(['mine', 'sub-page'])
    expect(usePreviewStore.getState().previewTabsBySession['sub-1']).toBeUndefined()

    routePreviewClosed('sub-1', {
      type: 'preview.closed',
      sessionId: 'sub-1',
      backgroundOnly: true,
    })
    expect(strip()).toEqual(['mine'])
  })
})

describe('agent terminal reveal', () => {
  const seeded: string[] = []
  const opened = (sessionId: string, terminalId: string) => {
    seeded.push(terminalId)
    routeTerminalOpened(sessionId, { type: 'terminal.opened', sessionId, terminalId })
  }
  // The route seeds the shared live-terminal registry; leave it as it was for the next file.
  afterEach(() => {
    for (const id of seeded.splice(0)) useLiveTerminalsStore.getState().noteFinished(id)
  })

  test('a pane opened by a background chat does not pull the person out of the one they read', () => {
    const reveals: Array<{ terminalId: string; sessionId: string }> = []
    unregister = terminalBus.setJobOpener((request) => reveals.push(request))
    useChatStore.setState({ activeSessionId: 'reading' })

    opened('background', 'pty-background')
    opened('reading', 'pty-reading')

    expect(reveals.map(({ terminalId, sessionId }) => ({ terminalId, sessionId }))).toEqual([
      { terminalId: 'pty-reading', sessionId: 'reading' },
    ])
  })

  test('a sibling conversation’s pane joins the workspace without taking focus', () => {
    // One workspace: a sub-agent's pane belongs beside its parent's. But several sub-agents at
    // once would take turns pulling the workbench away from the conversation being read.
    setWorkspaceResolver((id) => (id.startsWith('sub-') ? 'reading' : null))
    try {
      const opens: Array<{ terminalId: string; reveal?: boolean }> = []
      unregister = terminalBus.setJobOpener(({ terminalId, reveal }) =>
        opens.push({ terminalId, reveal }),
      )
      useChatStore.setState({ activeSessionId: 'reading' })
      opened('sub-1', 'pty-sub')
      useChatStore.setState({ activeSessionId: 'sub-2' })
      opened('reading', 'pty-parent')
      opened('sub-2', 'pty-own')
      expect(opens).toEqual([
        { terminalId: 'pty-sub', reveal: false },
        { terminalId: 'pty-parent', reveal: false },
        { terminalId: 'pty-own', reveal: true },
      ])
    } finally {
      setWorkspaceResolver(() => null)
    }
  })
})

describe('produced-document auto-open', () => {
  test('opens the document in the grid of the chat that produced it, named on the request', () => {
    const calls: InspectorRequest[] = []
    unregister = registerInspectorHandler((request) => calls.push(request))
    useChatStore.setState({ activeSessionId: 'doc-session' })
    // Core's registry starts empty; an extension of the test's own keeps it from colliding.
    registerDedicatedViewerTypes({ routertestdoc: { contentType: 'x-test/doc', viewer: 'pdf' } })

    routeFsDocumentsOpened('doc-session', {
      type: 'fs.changed',
      sessionId: 'doc-session',
      paths: ['/w/out', '/w/out/report.routertestdoc'],
    } as Parameters<typeof routeFsDocumentsOpened>[1])

    expect(calls).toEqual([
      { kind: 'file', sessionId: 'doc-session', path: '/w/out/report.routertestdoc' },
    ])
  })
})
