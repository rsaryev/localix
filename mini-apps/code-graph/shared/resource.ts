import { sessionResourceAddress } from '@localixai/mini-app-sdk/session-resource'

/** The router's mount path: `/rpc/<mini app name>`, so it is this mini app's own. */
export const ROUTE_PATH = '/rpc/code-graph'

/**
 * The map's work item: one per chat (`scope: 'session'`), because a chat has a project and the map
 * is of that project. Two chats on two projects each see their own; two on one project share the
 * index behind them.
 */
export const GRAPH_KIND = 'code-graph:graph'

const graph = sessionResourceAddress('code-graph', 'graph')
const NODE_URI = 'localix://resource/code-graph/node/'

export const GRAPH_URI = graph.uri

/** The map of one chat's project; a tool opens THIS so it lands in the chat that asked. */
export const graphUri = graph.forSession

/** The session a map URI names, `null` for the bare one, `undefined` for another URI. */
export const sessionOfGraphUri = graph.sessionOf

/** One node as an attachable resource: what dragging a node into the composer links. */
export const nodeUri = (id: string) => `${NODE_URI}${encodeURIComponent(id)}`

export function nodeOfUri(uri: string): string | null {
  if (!uri.startsWith(NODE_URI)) return null
  try {
    return decodeURIComponent(uri.slice(NODE_URI.length)) || null
  } catch {
    return null
  }
}
