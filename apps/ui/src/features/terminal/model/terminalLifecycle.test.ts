import { afterEach, expect, test } from 'bun:test'
import { emptyEditorState, useGridStore } from '@/features/workspace-grid/model'
import { useChatStore } from '@/features/chat/model/store'
import {
  routeTerminalFinished,
  routeTerminalOpened,
} from '@/features/chat/model/sessionEventRouters'
import { terminal } from '@/shared/lib/terminalBus'
import { adoptTerminal, openOwnedTerminal, revealTerminal } from './terminalTabs'
import { finishTerminalTabs } from './deadTerminalTabs'
import { useLiveTerminalsStore } from './liveTerminals'

const originalGrid = useGridStore.getState()
const originalChat = useChatStore.getState()
let unsubscribe: (() => void) | undefined

afterEach(() => {
  unsubscribe?.()
  unsubscribe = undefined
  useGridStore.setState(originalGrid)
  useChatStore.setState(originalChat)
  useLiveTerminalsStore.getState().noteFinished('failed')
})

function setup() {
  useGridStore.setState(emptyEditorState('test-group'))
  useChatStore.setState({ activeSessionId: 's1' })
  unsubscribe = terminal.setJobOpener(adoptTerminal)
}

const item = () => useGridStore.getState().items['terminal:failed']
const failure = { exitCode: 1, command: 'demo-command', interactive: false }

test('a background terminal opened from its strip row keeps the error reported before it attaches', () => {
  setup()
  routeTerminalOpened({
    type: 'terminal.opened',
    sessionId: 's1',
    terminalId: 'failed',
    command: failure.command,
  })
  // The agent's pane opens no tab by itself; the person opens it.
  expect(item()).toBeUndefined()
  terminal.openJob({ sessionId: 's1', terminalId: 'failed', title: failure.command })
  routeTerminalFinished('s1', {
    type: 'terminal.finished',
    sessionId: 's1',
    terminalId: 'failed',
    exitCode: failure.exitCode,
    command: failure.command,
  })
  expect(item()?.payload?.terminalExit).toMatchObject({
    exitCode: failure.exitCode,
    command: failure.command,
  })
  const exit = item()?.payload?.terminalExit as { interactive?: boolean } | undefined
  expect(exit?.interactive).not.toBe(true)
  expect(useGridStore.getState().closed).toEqual([])
  expect(useLiveTerminalsStore.getState().ids.has('failed')).toBe(false)
})

test('re-adopting or revealing an exited terminal preserves its error and ownership', () => {
  setup()
  openOwnedTerminal('s1', 'failed', 'Program')
  finishTerminalTabs('failed', failure)
  adoptTerminal({ sessionId: 's1', terminalId: 'failed' })
  expect(item()?.payload).toMatchObject({ owned: true, terminalExit: failure })
  revealTerminal({ sessionId: 's1', terminalId: 'failed' })
  expect(item()?.payload?.terminalExit).toEqual(failure)
  const grid = useGridStore.getState()
  grid.closeTab(grid.activeGroup, 'terminal:failed')
  terminal.openJob({ sessionId: 's1', terminalId: 'failed' })
  expect(item()?.payload).toMatchObject({ owned: true, terminalExit: failure })
})

test('a confirmed failure cannot be closed by a later shell-success or unknown observation', () => {
  setup()
  adoptTerminal({ sessionId: 's1', terminalId: 'failed' })
  finishTerminalTabs('failed', failure)
  finishTerminalTabs('failed', { exitCode: 0, interactive: true })
  finishTerminalTabs('failed', { exitCode: null })
  expect(item()?.payload?.terminalExit).toEqual(failure)
  expect(useGridStore.getState().closed).toEqual([])
})
