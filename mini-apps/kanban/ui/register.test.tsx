import { afterEach, describe, expect, test } from 'bun:test'
import type {
  CommentActionContribution,
  SessionSurfaceContribution,
  ToolCardContribution,
  UiAnchorContribution,
  WorkItemKindContribution,
} from '@localixai/mini-app-sdk/ui'
import { recordingMiniAppUiHost } from '@localixai/mini-app-sdk/ui/testing'

import {
  BOARD_KIND,
  BOARD_URI,
  boardUri,
  SEARCH_PROVIDER_ID,
  TASK_KIND,
  taskUri,
} from '../shared/resource'
import { KANBAN_TOOL } from '../shared/tool'
import { resetBoardStore } from './model/boardStore'
import { registerUi } from './register'
import { fakeBoardBackend, type FakeBoardBackend } from './testing/fakeBoardBackend'

function registered() {
  const { host, registrations } = recordingMiniAppUiHost()
  registerUi(host)
  registerUi(host)
  const kinds = registrations.workItems as WorkItemKindContribution[]
  return {
    registrations,
    board: kinds.find((kind) => kind.kind === BOARD_KIND)!,
    task: kinds.find((kind) => kind.kind === TASK_KIND)!,
    anchor: registrations.anchors[0] as UiAnchorContribution,
  }
}

describe('registerUi', () => {
  test('one board per chat and a card tab beside it, registered once per host', () => {
    const { registrations, board, task } = registered()
    expect(registrations.workItems).toHaveLength(2)
    expect(board).toMatchObject({ restorable: true, scope: 'session' })
    expect(task).toMatchObject({ scope: 'session' })
    // A card lands where the board is (the editor area), not in the side panel chats stack in.
    expect(board?.placement).toBeUndefined()
    expect(task?.placement).toBeUndefined()
    expect(registrations.railViewlets[0]).toMatchObject({ kind: BOARD_KIND, title: 'Board' })
    expect((registrations.toolCards[0] as ToolCardContribution).tool).toBe(KANBAN_TOOL)
    expect((registrations.sessionSurfaces[0] as SessionSurfaceContribution).surface).toBe(
      'composer.header',
    )
    expect(registrations.resourceRefIcons).toHaveLength(1)
  })

  test('the search domain is the provider the backend registers', () => {
    const { registrations } = registered()
    expect(registrations.search[0]).toMatchObject({ id: SEARCH_PROVIDER_ID })
  })

  test('a board or card URI opens in the chat it names; the bare board names none', () => {
    const { anchor } = registered()
    expect(anchor.resolve(boardUri('s7'))).toMatchObject({ workKind: BOARD_KIND, session: 's7' })
    // No `session`: the host resolves the bare board against the chat the link was followed from.
    // The anchor must not guess one — there is no active session to read.
    expect(anchor.resolve(BOARD_URI)).not.toHaveProperty('session')
    expect(anchor.resolve(taskUri('s7', 'LX-3'))).toEqual({
      kind: 'work-item',
      workKind: TASK_KIND,
      id: `${TASK_KIND}:LX-3`,
      title: 'LX-3',
      payload: { taskId: 'LX-3' },
      session: 's7',
    })
    expect(anchor.resolve('localix://resource/kanban/other')).toBeNull()
  })

  test('a dragged board or card tab links as the resource of its own chat', () => {
    const { board, task } = registered()
    const inChat = { session: 's7' }
    const boardTab = { kind: BOARD_KIND, id: BOARD_KIND, title: 'Board' }
    expect(board.toMessageBinding?.(boardTab, inChat)?.target).toMatchObject({
      uri: boardUri('s7'),
    })
    expect(board.toMessageBinding?.(boardTab, { session: null })).toBeNull()
    const cardTab = { kind: TASK_KIND, id: 'x', title: 'Card', payload: { taskId: 'LX-3' } }
    expect(task.toMessageBinding?.(cardTab, inChat)?.target).toMatchObject({
      uri: taskUri('s7', 'LX-3'),
    })
  })
})

describe('the comment action', () => {
  let backend: FakeBoardBackend
  afterEach(() => {
    resetBoardStore()
    backend?.unbind()
  })

  test('a batch becomes one backlog card on the board of the chat it was written in', async () => {
    backend = fakeBoardBackend()
    const { registrations } = registered()
    const action = registrations.commentActions[0] as CommentActionContribution
    expect(action).toMatchObject({ id: 'kanban:task', label: 'Task' })

    const files = Array.from({ length: 25 }, (_, i) => `src/file-${i}.ts`)
    const result = await action.run({
      sessionId: 's3',
      title: 'x'.repeat(250),
      summary: 'Fix the null check.',
      files,
    })

    expect(result).toEqual({ message: 'Added to the board backlog' })
    const create = backend.requests.find((r) => r.method === 'POST')
    expect(create).toMatchObject({ path: '/rpc/kanban/tasks', sessionId: 's3' })
    // Clipped to the contract's caps, so a long batch is still a card rather than a refusal.
    expect(create!.body).toEqual({
      title: `${'x'.repeat(199)}…`,
      description: 'Fix the null check.',
      status: 'backlog',
      attachedPaths: files.slice(0, 20),
    })
  })
})
