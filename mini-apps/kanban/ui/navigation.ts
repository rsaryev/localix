import type { UiAnchorWorkItem } from '@localixai/mini-app-sdk/ui'
import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'

import { BOARD_KIND, parseKanbanUri, TASK_KIND } from '../shared/resource'

/**
 * Where the board's tabs open, in one place: the board of a chat, and one card beside it.
 *
 * Both are SESSION-scoped. A board is one chat's, so a link to it must open in THAT chat — the one
 * the card or the tool call belongs to — and never in whichever chat happens to be active when
 * the click lands; opening the board from chat B for a card of chat A would show B's board and
 * claim the card was missing. So every open names its session, and the host puts the tab there.
 */

export const BOARD_TITLE = 'Board'

/** A card's tab id: owner-prefixed, one per card of the chat it opens in. */
export const taskItemId = (taskId: string) => `${TASK_KIND}:${taskId}`

export function openBoard(sessionId: string): void {
  miniAppWorkspace.openWorkItem({
    workKind: BOARD_KIND,
    id: BOARD_KIND,
    title: BOARD_TITLE,
    scope: sessionId,
  })
}

/** Open one card on its own. `title` names the tab; the card's id stands in when unknown. */
export function openTask(sessionId: string, task: { id: string; title?: string }): void {
  miniAppWorkspace.openWorkItem({
    workKind: TASK_KIND,
    id: taskItemId(task.id),
    title: task.title || task.id,
    scope: sessionId,
    payload: { taskId: task.id },
  })
}

/**
 * What a board URI opens — the `kanban` anchor's answer, shared by search hits, `@resource:` chips
 * and the tool's reveal. A URI that names its chat opens there; the bare board URI names none, so
 * the answer carries no `session` and the HOST resolves it against the chat the link was followed
 * from (the transcript or tab it was clicked in) — never the one on screen, and never guessed here.
 * A card URI always names its chat, because a card id is only unique within one.
 */
export function resolveKanbanAnchor(uri: string): UiAnchorWorkItem | null {
  const address = parseKanbanUri(uri)
  if (!address) return null
  if (address.kind === 'board') {
    return {
      kind: 'work-item',
      workKind: BOARD_KIND,
      id: BOARD_KIND,
      title: BOARD_TITLE,
      ...(address.sessionId ? { session: address.sessionId } : {}),
    }
  }
  return {
    kind: 'work-item',
    workKind: TASK_KIND,
    id: taskItemId(address.taskId),
    title: address.taskId,
    payload: { taskId: address.taskId },
    session: address.sessionId,
  }
}
