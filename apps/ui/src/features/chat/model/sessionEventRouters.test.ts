import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { setWorkspaceResolver } from '@/shared/lib/workspaceOf'

import { usePreviewStore } from '@/features/inspector/model/previewStore'
import { registerInspectorHandler, type InspectorRequest } from '@/shared/lib/inspectorBus'
import {
  routeFsChanged,
  routePreviewClosed,
  routePreviewUpdated,
  routeTerminalOpened,
  routeTerminalState,
  routePreviewCommand,
} from './sessionEventRouters'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import { useLiveTerminalsStore } from '@/features/terminal/model/liveTerminals'
import { useTerminalStatesStore } from '@/features/terminal/model/terminalStates'
import { emptyEditorState, useGridStore } from '@/features/workspace-grid/model'
import { registerDedicatedViewerTypes } from '@/shared/lib/contentTypeRouting'
import { useChatStore } from './store'
import { previewHostKey, usePreviewHosts } from '@/features/inspector/model/previewHosts'

let unregister: (() => void) | undefined
const originalGrid = useGridStore.getState()

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

describe('the app opens nothing on its own', () => {
  // Showing a terminal or a file is the agent's call (`open`); its events only update state.
  const seeded: string[] = []
  afterEach(() => {
    for (const id of seeded.splice(0)) useLiveTerminalsStore.getState().noteFinished(id)
    useGridStore.setState(originalGrid)
  })

  test('a terminal the agent opened, then taken over by a full-screen app, opens no tab', () => {
    const sessionId = 'reading'
    const terminalId = 'pty-agent'
    seeded.push(terminalId)
    useGridStore.setState(emptyEditorState('router-group'))
    useChatStore.setState({ activeSessionId: sessionId })
    const opens: string[] = []
    unregister = terminalBus.setJobOpener((request) => opens.push(request.terminalId))

    routeTerminalOpened({ type: 'terminal.opened', sessionId, terminalId, command: 'claude' })
    routeTerminalState(sessionId, {
      type: 'terminal.state',
      sessionId,
      terminalId,
      command: 'claude',
      altScreen: true,
    })

    expect(opens).toEqual([])
    expect(useGridStore.getState().items[`terminal:${terminalId}`]).toBeUndefined()
    expect(useGridStore.getState().activeGroup).toBe('router-group')
    // The bookkeeping still lands: the pane is alive and its takeover is recorded.
    expect(useLiveTerminalsStore.getState().ids.has(terminalId)).toBe(true)
    expect(useTerminalStatesStore.getState().bySession[sessionId]).toEqual([
      { terminalId, command: 'claude', altScreen: true },
    ])
  })

  test('a file the agent wrote, a document included, opens nothing', () => {
    const calls: InspectorRequest[] = []
    unregister = registerInspectorHandler((request) => calls.push(request), { isOpen: () => true })
    useChatStore.setState({ activeSessionId: 'doc-session' })
    registerDedicatedViewerTypes({ routertestdoc: { contentType: 'x-test/doc', viewer: 'pdf' } })

    routeFsChanged('doc-session', {
      type: 'fs.changed',
      sessionId: 'doc-session',
      paths: ['/w/out', '/w/out/report.routertestdoc', '/w/src/app.ts'],
    } as Parameters<typeof routeFsChanged>[1])

    expect(calls).toEqual([])
  })
})

describe('a command to a released preview', () => {
  test('brings its renderer back off screen so the command is answered', () => {
    usePreviewHosts.setState({ live: {}, foreground: {} })
    routePreviewCommand('s1', {
      type: 'preview.command',
      commandId: 'c1',
      command: { action: 'snapshot', previewId: 'tab-1' },
    } as never)
    expect(usePreviewHosts.getState().live[previewHostKey('s1', 'tab-1')]).toBe(true)
    usePreviewHosts.setState({ live: {}, foreground: {} })
  })
})
