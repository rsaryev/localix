import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { registerDedicatedViewerTypes } from '@/shared/lib/contentTypeRouting'
import { registerInspectorHandler, type InspectorRequest } from '@/shared/lib/inspectorBus'
import { useUserSettings } from '@/features/settings/model/useUserSettings'
import { useChatStore } from './store'
import { routeFollowAgentEdits, routeFsDocumentsOpened } from './sessionEventRouters'

const initialSettings = useUserSettings.getState().settings
let unregister: (() => void) | undefined
let calls: InspectorRequest[]

function follow(enabled: boolean) {
  useUserSettings.setState({
    settings: {
      ...initialSettings,
      agentSettings: {
        ...initialSettings.agentSettings,
        followAgentEdits: { enabled },
      },
    },
  })
}

function change(sessionId: string, paths: string[]) {
  return { type: 'fs.changed', sessionId, paths } as Parameters<typeof routeFsDocumentsOpened>[1]
}

beforeEach(() => {
  calls = []
  unregister = registerInspectorHandler((request) => calls.push(request), { isOpen: () => true })
  registerDedicatedViewerTypes({ eventtestdoc: { contentType: 'x-test/eventdoc', viewer: 'pdf' } })
})

afterEach(() => {
  unregister?.()
  useChatStore.setState({ activeSessionId: null })
  useUserSettings.setState({ settings: initialSettings })
})

describe('session file event history', () => {
  test('documents and followed edits each retain their own twelve-path cap', () => {
    const sessionId = 'file-events-independent-caps'
    useChatStore.setState({ activeSessionId: sessionId })
    follow(true)
    for (let i = 0; i < 14; i++) {
      const event = change(sessionId, [`/w/${i}.eventtestdoc`, `/w/${i}.ts`])
      routeFsDocumentsOpened(sessionId, event)
      routeFollowAgentEdits(sessionId, event)
    }
    expect(calls).toHaveLength(24)
    expect(calls.slice(0, 4)).toEqual([
      { kind: 'file', sessionId, path: '/w/0.eventtestdoc' },
      { kind: 'file', sessionId, path: '/w/0.ts' },
      { kind: 'file', sessionId, path: '/w/1.eventtestdoc' },
      { kind: 'file', sessionId, path: '/w/1.ts' },
    ])
    const replay = change(sessionId, ['/w/0.ts', '/w/0.eventtestdoc'])
    routeFsDocumentsOpened(sessionId, replay)
    routeFollowAgentEdits(sessionId, replay)
    expect(calls).toHaveLength(24)
  })

  test('disabled and background events do not consume a followed path', () => {
    const sessionId = 'file-events-gates'
    const event = change(sessionId, ['/w/first.ts', '/w/latest.ts'])
    useChatStore.setState({ activeSessionId: sessionId })
    follow(false)
    routeFollowAgentEdits(sessionId, event)
    follow(true)
    useChatStore.setState({ activeSessionId: 'another-session' })
    routeFollowAgentEdits(sessionId, event)
    routeFsDocumentsOpened(sessionId, change(sessionId, ['/w/gated.eventtestdoc']))
    expect(calls).toEqual([])
    useChatStore.setState({ activeSessionId: sessionId })
    routeFollowAgentEdits(sessionId, event)
    routeFollowAgentEdits(sessionId, change(sessionId, ['/w/new.ts', '/w/latest.ts']))
    routeFsDocumentsOpened(sessionId, change(sessionId, ['/w/gated.eventtestdoc']))
    expect(calls).toEqual([
      { kind: 'file', sessionId, path: '/w/latest.ts' },
      { kind: 'file', sessionId, path: '/w/gated.eventtestdoc' },
    ])
  })

  test('documents open a closed panel while a suppressed gentle reveal still records its path', () => {
    const sessionId = 'file-events-closed-panel'
    let visible = false
    unregister?.()
    unregister = registerInspectorHandler((request) => calls.push(request), {
      isOpen: () => visible,
    })
    useChatStore.setState({ activeSessionId: sessionId })
    follow(true)
    const code = change(sessionId, ['/w/hidden.ts'])
    routeFollowAgentEdits(sessionId, code)
    expect(calls).toEqual([])
    routeFsDocumentsOpened(sessionId, change(sessionId, ['/w/visible.eventtestdoc']))
    visible = true
    routeFollowAgentEdits(sessionId, code)
    routeFollowAgentEdits(sessionId, change(sessionId, ['/w/next.ts']))
    expect(calls).toEqual([
      { kind: 'file', sessionId, path: '/w/visible.eventtestdoc' },
      { kind: 'file', sessionId, path: '/w/next.ts' },
    ])
  })

  test('session history evicts by creation order, without refreshing a replayed session', () => {
    const emit = (i: number) => {
      const id = `file-events-fifo-${i}`
      useChatStore.setState({ activeSessionId: id })
      routeFsDocumentsOpened(id, change(id, ['/w/report.eventtestdoc']))
    }
    for (let i = 0; i < 500; i++) emit(i)
    emit(0)
    expect(calls).toHaveLength(500)
    emit(500)
    emit(0)
    expect(calls).toHaveLength(502)
  })
})
