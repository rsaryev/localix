import { localixUri, parseLocalixUri } from '@localixai/mini-app-sdk/navigation'

/**
 * The board's addresses: its route, its work items, its live stream and its URIs. Values both
 * sides import, so a writer and a reader can never disagree on a spelling.
 */

/** The router's mount path: `/rpc/<mini app name>`, so it is this mini app's own. */
export const ROUTE_PATH = '/rpc/kanban'

/** One board per chat session (`scope: 'session'`). */
export const BOARD_KIND = 'kanban:board'
/** One card opened on its own, beside its board. */
export const TASK_KIND = 'kanban:task'

/** The search group: the backend provider's id and the UI domain's, one value for both. */
export const SEARCH_PROVIDER_ID = 'kanban:tasks'

/** The live stream: a view subscribes for one session's board and receives `b\n<BoardEvent>`. */
export const BOARD_FRAME_TAG = 'b'
export const BOARD_SUBSCRIBE = 'kanban:board.subscribe'
export const BOARD_UNSUBSCRIBE = 'kanban:board.unsubscribe'

/**
 * The board's URIs are built and parsed by the SDK's one Localix URI grammar, never by string
 * prefixes: a session id is an opaque segment that may hold `/` or `%`, and a hand-rolled
 * `startsWith(... + '/')` split is exactly where such an id would name a different resource.
 */
const PROVIDER = 'kanban'
export const BOARD_URI = localixUri('resource', [PROVIDER, 'board'])

/** One chat's board: what the tool opens, naming the session it ran in. */
export const boardUri = (sessionId: string) =>
  localixUri('resource', [PROVIDER, 'board', sessionId])

/** One card of one chat's board. */
export const taskUri = (sessionId: string, taskId: string) =>
  localixUri('resource', [PROVIDER, 'task', sessionId, taskId])

export type KanbanAddress =
  | { kind: 'board'; sessionId: string | null }
  | { kind: 'task'; sessionId: string; taskId: string }

/** What a board URI names; `undefined` for any other URI. */
export function parseKanbanUri(uri: string): KanbanAddress | undefined {
  const parsed = parseLocalixUri(uri)
  if (parsed?.primitive !== 'resource' || parsed.breadcrumbs[0] !== PROVIDER) return undefined
  const [, kind, sessionId, taskId, ...rest] = parsed.breadcrumbs
  if (rest.length > 0) return undefined
  if (kind === 'board' && taskId === undefined)
    return { kind: 'board', sessionId: sessionId ?? null }
  if (kind === 'task' && sessionId && taskId) return { kind: 'task', sessionId, taskId }
  return undefined
}
