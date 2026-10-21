import { afterEach, describe, expect, test } from 'bun:test'
import { registerInspectorHandler, type InspectorRequest } from '@/shared/lib/inspectorBus'
import { routeFsChanged, routeTerminalOpened, routeTerminalState } from './sessionEventRouters'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import { useLiveTerminalsStore } from '@/shared/lib/terminals/liveTerminals'
import { useTerminalStatesStore } from '@/shared/lib/terminals/terminalStates'
import { emptyEditorState, useGridStore } from '@/features/workspace-grid/model'
import { registerDedicatedViewerTypes } from '@/shared/lib/contentTypeRouting'
import { useChatStore } from './store'

let unregister: (() => void) | undefined
const originalGrid = useGridStore.getState()

afterEach(() => {
  unregister?.()
  unregister = undefined
  useChatStore.setState({ activeSessionId: null })
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
