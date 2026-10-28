import {
  assertMiniAppResponse,
  miniAppApiFetch,
  unwrapMiniAppResponse,
} from '@localixai/mini-app-sdk/ui/transport'

import type {
  CreateKanbanTaskRequest,
  KanbanBoard,
  KanbanMove,
  KanbanTask,
  UpdateKanbanTaskRequest,
} from '../../shared/contracts'
import { ROUTE_PATH } from '../../shared/resource'

/**
 * The board's routes, typed, for ONE chat's board at a time.
 *
 * Every call names the chat it is about. The host resolves `?sessionId=` against the person's own
 * chats and hands the route nothing for a foreign or deleted one, so a request without it has no
 * board to read — and a client that defaulted to "the active chat" would act on whichever chat
 * the person had switched to while a background tab kept talking. So the session is a required
 * argument of every method, never ambient state.
 *
 * Failures reject with the SDK's `MiniAppApiError`, which carries the route's own sentence and
 * code (`task_changed`, `forbidden_transition`, …) and its HTTP status (`taskIsGone` reads 404).
 */

/** An agent a card may be assigned to, as the host's agent directory lists it. */
export interface BoardAgent {
  id: string
  name: string
  description?: string
}

const route = (sessionId: string, path: string) =>
  `${ROUTE_PATH}${path}?sessionId=${encodeURIComponent(sessionId)}`

const card = (id: string) => `/tasks/${encodeURIComponent(id)}`

const json = (method: 'POST' | 'PATCH', body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

async function read<T>(sessionId: string, path: string, init?: RequestInit): Promise<T> {
  return unwrapMiniAppResponse<T>(await miniAppApiFetch(route(sessionId, path), init))
}

export const boardApi = {
  board: (sessionId: string) => read<KanbanBoard>(sessionId, '/board'),

  agents: async (sessionId: string): Promise<BoardAgent[]> =>
    (await read<{ agents: BoardAgent[] }>(sessionId, '/agents')).agents,

  create: (sessionId: string, input: CreateKanbanTaskRequest) =>
    read<KanbanTask>(sessionId, '/tasks', json('POST', input)),

  /** One drag, one request: the server checks every move before writing any of them. */
  move: async (sessionId: string, moves: readonly KanbanMove[]): Promise<KanbanTask[]> =>
    (await read<{ tasks: KanbanTask[] }>(sessionId, '/moves', json('POST', { moves }))).tasks,

  task: (sessionId: string, id: string) => read<KanbanTask>(sessionId, card(id)),

  update: (sessionId: string, id: string, patch: UpdateKanbanTaskRequest) =>
    read<KanbanTask>(sessionId, card(id), json('PATCH', patch)),

  async remove(sessionId: string, id: string): Promise<void> {
    await assertMiniAppResponse(
      await miniAppApiFetch(route(sessionId, card(id)), { method: 'DELETE' }),
    )
  },
}
