import { z } from 'zod'
import { lensSchema } from './lens'
import { EDGE_KINDS, LANGUAGES } from './model'
import { crumbSchema, nodeSummarySchema } from './node-schema'
import { graphCameraSchema } from './camera'

/**
 * The one snapshot the workbench polls, validated on arrival.
 *
 * It carries only what is on screen — one level of the tree, the selected node's relations, the
 * agent's highlight — never the whole graph: a large project's graph is tens of megabytes, and a
 * view that downloaded it to draw two hundred boxes would be slow exactly where the map matters.
 */
const edgeKind = z.enum(EDGE_KINDS)

export { nodeSummarySchema }

export const viewNodeSchema = nodeSummarySchema.extend({
  /**
   * `child` is a box of the level; `tile` sits inside its `group` (a child that contains code);
   * `portal` stands for code outside the level that it connects to.
   */
  role: z.enum(['child', 'tile', 'portal']),
  /** For a tile: the child it is drawn inside. */
  group: z.string().optional(),
  /** For a container child: how many of its children are not drawn as tiles. */
  hiddenTiles: z.number().optional(),
})

export const viewEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  count: z.number(),
  kinds: z.partialRecord(edgeKind, z.number()),
  /** The two ends depend on each other both ways: part of a cycle at this level. */
  cyclic: z.boolean().optional(),
})

export { crumbSchema }

export const graphViewSchema = z.object({
  scope: nodeSummarySchema,
  breadcrumb: z.array(crumbSchema),
  nodes: z.array(viewNodeSchema),
  edges: z.array(viewEdgeSchema),
  /** Children left out to keep the level readable, the least connected first. */
  truncated: z.number(),
})

export const relationSchema = z.object({
  node: nodeSummarySchema,
  kind: edgeKind,
  count: z.number(),
  line: z.number(),
})

export const nodeDetailSchema = z.object({
  node: nodeSummarySchema,
  breadcrumb: z.array(crumbSchema),
  incoming: z.array(relationSchema),
  outgoing: z.array(relationSchema),
  /** Relations past the ones listed. */
  moreIncoming: z.number(),
  moreOutgoing: z.number(),
  /** Files that depend on this node within three hops. */
  impactFiles: z.number(),
})

export const indexStatusSchema = z.object({
  state: z.enum(['empty', 'indexing', 'ready', 'failed']),
  phase: z.enum(['discovering', 'parsing', 'linking']).optional(),
  progress: z.object({ done: z.number(), total: z.number() }).optional(),
  error: z.string().optional(),
  revision: z.number(),
  builtAt: z.string().optional(),
  omitted: z.number(),
})

export const graphStatsSchema = z.object({
  files: z.number(),
  symbols: z.number(),
  languages: z.partialRecord(z.enum(LANGUAGES), z.number()),
  edges: z.record(edgeKind, z.number()),
  calls: z.object({ total: z.number(), resolved: z.number(), external: z.number() }),
  imports: z.object({
    total: z.number(),
    internal: z.number(),
    external: z.number(),
    unresolved: z.number(),
  }),
})

/** What the agent last asked the view to show; `revision` lets the view apply it exactly once. */
export const agentViewSchema = z.object({
  revision: z.number(),
  scope: z.string().optional(),
  focus: z.string().optional(),
  highlight: z.array(z.string()),
  note: z.string().optional(),
  trail: z.array(z.string()).max(6).optional(),
  camera: graphCameraSchema.optional(),
  requestedAt: z.number().optional(),
})

export const graphSnapshotSchema = z.object({
  project: z.string(),
  /** Absolute project directory: the host editor opens files by absolute path. */
  root: z.string(),
  status: indexStatusSchema,
  stats: graphStatsSchema.optional(),
  view: graphViewSchema.optional(),
  /** The call lens, when functions are open in it (`shared/lens.ts`). */
  lens: lensSchema.optional(),
  /** The selected node, or the level itself when nothing is selected. */
  selection: nodeDetailSchema.optional(),
  search: z.array(nodeSummarySchema).optional(),
  /** Import cycles with a file under the level. */
  cycles: z.array(z.array(z.string())).optional(),
  /** The files under the level that the most code depends on. */
  hubs: z.array(nodeSummarySchema).optional(),
  agent: agentViewSchema.optional(),
})

export type NodeSummaryView = z.infer<typeof nodeSummarySchema>
export type ViewNode = z.infer<typeof viewNodeSchema>
export type ViewEdge = z.infer<typeof viewEdgeSchema>
export type GraphView = z.infer<typeof graphViewSchema>
export type NodeDetail = z.infer<typeof nodeDetailSchema>
export type AgentView = z.infer<typeof agentViewSchema>
export type GraphSnapshot = z.infer<typeof graphSnapshotSchema>
export type Crumb = z.infer<typeof crumbSchema>
