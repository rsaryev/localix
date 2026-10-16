import { localixUri, parseLocalixUri } from '@localixai/plugin-sdk/navigation'

/**
 * The board's addresses: its route, its tab and its URI — values both sides import, so a writer
 * and a reader can never disagree on a spelling. There is one board per project; the URI names
 * the chat it is opened from because the chat is how the host knows which project that is.
 */
export const ROUTE_PATH = '/rpc/project-space'

/** Where the board lives in its project (project-relative, `/`-separated), and its pasted files. */
export const BOARD_DIR = '.localix/project-space'
export const BOARD_FILE = `${BOARD_DIR}/space.json`
export const PASTED_DIR = `${BOARD_DIR}/files`
export const SPACE_KIND = 'project-space:space'
export const SPACE_TITLE = 'Project Space'
export const SPACE_FRAME_TAG = 'p'
export const SPACE_SUBSCRIBE = 'project-space:subscribe'
export const SPACE_UNSUBSCRIBE = 'project-space:unsubscribe'
export const SPACE_TOOLS = {
  read: 'space_read',
  apply: 'space_apply',
  view: 'space_view',
} as const

const PROVIDER = 'project-space'

export const spaceUri = (sessionId: string) =>
  localixUri('resource', [PROVIDER, 'space', sessionId])

/** The chat a board URI names; `undefined` for any other URI, `null` for the bare board URI. */
export function parseSpaceUri(uri: string): { sessionId: string | null } | undefined {
  const parsed = parseLocalixUri(uri)
  if (parsed?.primitive !== 'resource' || parsed.breadcrumbs[0] !== PROVIDER) return undefined
  const [, kind, sessionId, ...rest] = parsed.breadcrumbs
  if (kind !== 'space' || rest.length > 0) return undefined
  return { sessionId: sessionId ?? null }
}
