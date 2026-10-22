import { z } from 'zod'
import { agentViewSchema } from './view'

/**
 * The map's live stream on the realtime socket: what the backend PUSHES to one chat's open tab.
 *
 * The tab used to ask instead — a long-poll for the agent's requests re-issued every second, and a
 * camera report POSTed every second whether anyone was asking — so an idle open map cost two
 * requests a second for as long as it stayed open. Each frame here is one thing that happened:
 *
 * - `agent`: the agent asked the map to show something (`code_graph_show`, a camera move);
 * - `report`: a tool wants to know what the tab shows right now — answer with a camera report;
 * - `revision`: the index published, or finished a refresh — re-read the snapshot;
 * - `indexing`: a refresh moved (a phase, parsed files), at most about once a second — a tab
 *   showing the build re-reads its progress, which it used to poll for every 1.5 s.
 */
export const GRAPH_FRAME_TAG = 'g'
export const GRAPH_SUBSCRIBE = 'code-graph:subscribe'
export const GRAPH_UNSUBSCRIBE = 'code-graph:unsubscribe'

export const graphFrameSchema = z.union([
  z.object({ sessionId: z.string(), agent: agentViewSchema }),
  z.object({ sessionId: z.string(), report: z.number().int().nonnegative() }),
  z.object({ sessionId: z.string(), revision: z.number().int().nonnegative() }),
  z.object({ sessionId: z.string(), indexing: z.enum(['discovering', 'parsing', 'linking']) }),
])

export type GraphFrame = z.infer<typeof graphFrameSchema>
