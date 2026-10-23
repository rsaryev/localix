import type { CommentBatch } from '@localixai/mini-app-sdk/ui'

import type { CreateKanbanTaskRequest } from '../shared/contracts'
import { boardApi } from './api/board-client'
import { acceptTask } from './model/boardStore'

/**
 * A batch of review comments as a backlog card on the board of the chat they were written in.
 *
 * The batch is the person's words, so nothing of it may be lost to a limit: the contract caps a
 * title, a description and the attached paths, and a batch over any cap would be refused whole
 * — the comments kept, but the card never made. So each part is clipped to its cap, the title
 * alone ending in an ellipsis because it is the part read at a glance.
 */
const TITLE_MAX = 200
const DESCRIPTION_MAX = 8000
const PATHS_MAX = 20

export function commentTaskRequest(batch: CommentBatch): CreateKanbanTaskRequest {
  const title = batch.title.trim() || 'Review comments'
  return {
    title: title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title,
    description: batch.summary.slice(0, DESCRIPTION_MAX),
    status: 'backlog',
    ...(batch.files.length ? { attachedPaths: batch.files.slice(0, PATHS_MAX) } : {}),
  }
}

export async function addCommentsToBoard(batch: CommentBatch): Promise<{ message: string }> {
  acceptTask(batch.sessionId, await boardApi.create(batch.sessionId, commentTaskRequest(batch)))
  return { message: 'Added to the board backlog' }
}
