import { beforeEach, describe, expect, test } from 'bun:test'
import { groupViewModel, scopedViewRoot, useGridStore } from '@/entities/workspace-grid/model'
import { __resetGridForTests } from '@/entities/workspace-grid/model/store'
import { makeTerminalItem, placeTerminal } from '@/features/terminal/model/terminalTabPlacement'
import type { InspectorRequest } from '@/shared/lib/inspectorBus'
import { resolveGridLayout } from '../ui/layout'
import { applyGridInspectorRequest } from './useGridInspectorBus'
import { syncGridChatSelection } from './useGridChatSync'

const get = () => useGridStore.getState()

/** Show `sessionId` the way the page does when the route selects it. */
const showChat = (sessionId: string) => syncGridChatSelection(get(), sessionId, 'Chat', null)

/** Whether the chat of `sessionId` is on screen: its group is laid out, not hidden, and shows it. */
function chatOnScreen(sessionId: string): boolean {
  const state = get()
  const layout = resolveGridLayout(scopedViewRoot(state), {
    isMobile: false,
    activeGroup: state.activeGroup,
    maximizedGroup: state.maximizedGroup,
  })
  return layout.leaves.some(
    ({ leaf, hidden }) =>
      !hidden &&
      groupViewModel(leaf, state.items, state.activeScope, [], state.scopeActiveTab)
        .visibleActive === `chat:${sessionId}`,
  )
}

const browser = (sessionId: string): InspectorRequest => ({
  kind: 'preview',
  sessionId,
  previewId: 'p1',
  url: 'https://example.com/',
  version: 0,
})

const file = (sessionId: string, path: string): InspectorRequest => ({
  kind: 'file',
  sessionId,
  path,
})

const openTerminal = (sessionId: string) =>
  placeTerminal(makeTerminalItem({ sessionId, terminalId: 't1', owned: false, title: 'Task' }))

beforeEach(() => __resetGridForTests())

describe('opening a work item beside the chat', () => {
  test('a file, the Browser and a terminal open beside the chat, never over it', () => {
    showChat('S1')
    applyGridInspectorRequest(file('S1', '/repo/README.md'))
    expect(chatOnScreen('S1')).toBe(true)
    applyGridInspectorRequest(browser('S1'))
    expect(chatOnScreen('S1')).toBe(true)
    openTerminal('S1')
    expect(chatOnScreen('S1')).toBe(true)
  })

  test('an OS file open is an ordinary open: it maximizes nothing', () => {
    showChat('S1')
    applyGridInspectorRequest(file('S1', '/Downloads/report.pdf'))
    expect(get().maximizedGroup).toBeNull()
    expect(chatOnScreen('S1')).toBe(true)
  })
})

describe('a maximize made in another conversation', () => {
  // The reported sequence: a group was maximized in one conversation (an OS file open used to do
  // it), the person went back to another, and the next Browser, terminal or `.md` link hid its
  // chat until they re-selected the conversation.
  for (const [name, open] of [
    ['the Browser', () => applyGridInspectorRequest(browser('S1'))],
    ['a file link', () => applyGridInspectorRequest(file('S1', '/repo/notes.md'))],
    ['a terminal', () => openTerminal('S1')],
  ] as const) {
    test(`does not hide this conversation's chat when ${name} opens`, () => {
      // Both chats are already open, as after a restart: going back reveals, never reopens.
      showChat('S1')
      showChat('S2')
      applyGridInspectorRequest(file('S2', '/Downloads/data.json'))
      get().maximizeGroup(get().activeGroup)
      expect(chatOnScreen('S2')).toBe(false)

      showChat('S1')
      expect(chatOnScreen('S1')).toBe(true)
      open()
      expect(get().maximizedGroup).toBeNull()
      expect(chatOnScreen('S1')).toBe(true)
    })
  }

  test('a maximize made in this conversation still holds while it stays on screen', () => {
    showChat('S1')
    applyGridInspectorRequest(file('S1', '/repo/a.ts'))
    const group = get().activeGroup
    get().maximizeGroup(group)
    applyGridInspectorRequest(file('S1', '/repo/b.ts'))
    expect(get().maximizedGroup).toBe(group)
  })
})
