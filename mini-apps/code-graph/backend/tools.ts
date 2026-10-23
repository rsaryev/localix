import type { CallClass, MiniAppContext } from '@localixai/mini-app-sdk/backend'
import { NODE_KINDS } from '../shared/model'
import { nodeLine } from '../shared/format'
import { ROOT_DIR_ID } from '../shared/ids'
import { graphUri } from '../shared/resource'
import { showInView } from './agent-view'
import {
  describeDetail,
  describeImpact,
  describeOverview,
  describePath,
  statusLine,
} from './describe'
import { searchNodes } from './graph/search'
import { impact, shortestPath } from './graph/traverse'
import { nodeDetail, viewScopeOf } from './graph/view'
import { projectIndex } from './indexing/projects'
import { findNode } from './refs'
import { LENS_KINDS, MAX_TRAIL } from '../shared/lens'
import { fileId } from '../shared/ids'
import { createGraphViewTool } from './view-tool'

/** What moving the person's Code Graph view does: changes what they see, nothing durable. */
export const VIEW_CALL: CallClass = { effect: 'view' }

/**
 * The agent's side of the map. Each tool answers from the graph of the project the run works in
 * (`ctx.cwd`), waits a bounded time for a first build, and leads with how complete the map is.
 *
 * Seven tools: where am I (overview), find (search), what is this (node), what
 * breaks (impact), how do these connect (path) — and show, which points the person's view at what
 * the agent is talking about; view reads or moves its camera. Every result carries accepted ids.
 */
const FIRST_BUILD_WAIT_MS = 20_000

export function createGraphTools(ctx: MiniAppContext) {
  const z = ctx.z
  const nodeArg = z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe(
      'A node id from an earlier result (e.g. "sym:src/a.ts#Client.send"), a project path, or a name.',
    )

  /** The published graph for this run's project, or the text that explains why there is none. */
  async function graphOrReason() {
    const index = projectIndex(ctx.dataDir, ctx.cwd)
    const published = await index.ready(FIRST_BUILD_WAIT_MS)
    const status = statusLine(index.snapshot(), published)
    return { index, published, status }
  }

  const readOnly = {
    executionMode: 'parallel' as const,
    mutates: false,
    permissionPaths: () => [],
  }

  return [
    ctx.defineTool({
      name: 'code_graph_overview',
      label: 'Code graph overview',
      activeVerb: 'Reading the code map',
      description:
        "Map of the project's code at one level: a directory's children with how much depends on them, the strongest dependencies between them, the most depended-on files and any import cycles. Start here to orient in an unfamiliar codebase before reading files.",
      inputSchema: z.object({
        path: z
          .string()
          .trim()
          .max(500)
          .optional()
          .describe('Directory or file to look inside; the project root when omitted.'),
      }),
      ...readOnly,
      async execute(_toolCallId, input) {
        const { published, status } = await graphOrReason()
        if (!published) return { content: status }
        const found = input.path ? findNode(published.graph, input.path) : null
        if (input.path && !found)
          return { content: `${status}\n\nNo directory or file matches "${input.path}".` }
        const scope = found ? viewScopeOf(published.graph, found.node.id) : ROOT_DIR_ID
        return { content: `${status}\n\n${describeOverview(published, scope)}` }
      },
    }),
    ctx.defineTool({
      name: 'code_graph_search',
      label: 'Search the code graph',
      activeVerb: 'Searching the code map',
      description:
        'Find classes, functions, methods, files or directories by name, part of a name or path. Results rank exact names first and, among equals, what more code depends on. Use the ids it returns with the other code_graph tools.',
      inputSchema: z.object({
        query: z.string().trim().min(1).max(200),
        kinds: z
          .array(z.enum(NODE_KINDS))
          .max(NODE_KINDS.length)
          .optional()
          .describe('Only these node kinds.'),
        limit: z.number().int().min(1).max(50).optional(),
        scope: nodeArg
          .optional()
          .describe(
            'Narrow results to a directory or file; use an exact id when the path is ambiguous.',
          ),
      }),
      ...readOnly,
      async execute(_toolCallId, input) {
        const { published, status } = await graphOrReason()
        if (!published) return { content: status }
        const scope = input.scope ? findNode(published.graph, input.scope) : null
        if (input.scope && (!scope || scope.note))
          return {
            content: `${status}\n\nSearch scope is missing or ambiguous. Pass an exact directory or file id.`,
            isError: true,
          }
        const hits = searchNodes(published.graph, input.query, {
          kinds: input.kinds,
          limit: input.limit ?? 15,
          scope: scope?.node.id,
        })
        const lines = hits.map((hit) => nodeLine(hit.node))
        return {
          content: `${status}\n\n${lines.length ? lines.join('\n') : `Nothing matches "${input.query}".`}`,
        }
      },
    }),
    ctx.defineTool({
      name: 'code_graph_node',
      label: 'Code graph node',
      activeVerb: 'Reading a node of the code map',
      description:
        'What one node connects to: what it imports, calls, extends or implements, and what imports, calls or extends it — for a class including its methods, for a file or directory everything inside it. Answers "who uses X" and "what does X depend on".',
      inputSchema: z.object({ node: nodeArg }),
      ...readOnly,
      async execute(_toolCallId, input) {
        const { published, status } = await graphOrReason()
        if (!published) return { content: status }
        const found = findNode(published.graph, input.node)
        const detail = found ? nodeDetail(published.graph, found.node.id) : null
        if (!found || !detail) return { content: `${status}\n\nNo node matches "${input.node}".` }
        return {
          content: [status, found.note, describeDetail(detail)].filter(Boolean).join('\n\n'),
        }
      },
    }),
    ctx.defineTool({
      name: 'code_graph_impact',
      label: 'Code graph impact',
      activeVerb: 'Tracing what depends on it',
      description:
        'Everything that depends on a node, transitively, grouped by file with the dependent symbols: the blast radius of changing it. Depth 1 is direct dependents only.',
      inputSchema: z.object({
        node: nodeArg,
        depth: z.number().int().min(1).max(5).optional().describe('Hops to follow; default 3.'),
      }),
      ...readOnly,
      async execute(_toolCallId, input) {
        const { published, status } = await graphOrReason()
        if (!published) return { content: status }
        const found = findNode(published.graph, input.node)
        if (!found) return { content: `${status}\n\nNo node matches "${input.node}".` }
        const depth = input.depth ?? 3
        const entries = impact(published.graph, found.node.id, depth)
        const text = describeImpact(published.graph, found.node.id, entries, depth)
        return { content: [status, found.note, text].filter(Boolean).join('\n\n') }
      },
    }),
    ctx.defineTool({
      name: 'code_graph_path',
      label: 'Code graph path',
      activeVerb: 'Finding how they connect',
      description:
        'The shortest chain of imports, calls and inheritance from one node to another — how a request handler reaches the database, how one module depends on another.',
      inputSchema: z.object({
        from: nodeArg,
        to: nodeArg,
        undirected: z
          .boolean()
          .optional()
          .describe('Also walk edges backwards, to find any connection at all.'),
      }),
      ...readOnly,
      async execute(_toolCallId, input) {
        const { published, status } = await graphOrReason()
        if (!published) return { content: status }
        const from = findNode(published.graph, input.from)
        const to = findNode(published.graph, input.to)
        if (!from || !to)
          return { content: `${status}\n\nNo node matches "${from ? input.to : input.from}".` }
        const steps = shortestPath(published.graph, from.node.id, to.node.id, {
          undirected: input.undirected,
        })
        const text = describePath(steps, from.node.id, to.node.id)
        return { content: [status, from.note, to.note, text].filter(Boolean).join('\n\n') }
      },
    }),
    ctx.defineTool({
      name: 'code_graph_show',
      label: 'Show in the code graph',
      activeVerb: 'Showing it on the code map',
      description:
        "Point this chat's Code Graph view at exact nodes. mode map opens the first node's level, selects it and highlights the others; mode lens opens source cards for up to six declarations in supplied order. Include an optional one-line note. Use code_graph_view inspect to verify the visible result.",
      inputSchema: z.object({
        nodes: z
          .array(nodeArg)
          .min(1)
          .max(30)
          .describe('Exact node ids: map selects the first; lens opens source cards in order.'),
        note: z.string().trim().max(200).optional().describe('One line shown above the map.'),
        mode: z
          .enum(['map', 'lens'])
          .optional()
          .describe(
            'map highlights nodes; lens opens source cards for up to six declarations, in the supplied order.',
          ),
      }),
      executionMode: 'sequential',
      // It points this chat's view (an in-memory command, `agent-view.ts`) and writes nothing
      // durable; `mutates: true` read as `external` and a plan session refused to show a node.
      mutates: false,
      classify: () => VIEW_CALL,
      permissionPaths: () => [],
      async execute(_toolCallId, input, _signal, _onUpdate, context) {
        const sessionId = context?.session?.id
        if (!sessionId)
          return { content: 'This run has no chat for a Code Graph view.', isError: true }
        const { index, published, status } = await graphOrReason()
        if (!published) return { content: status }
        const matches = input.nodes.map((ref) => findNode(published.graph, ref))
        const ambiguous = matches.find((match) => match?.note)
        if (ambiguous)
          return {
            content: `${status}\n\n${ambiguous.note}\nNothing was shown. Choose an exact id.`,
            isError: true,
          }
        if (matches.some((match) => !match))
          return {
            content: `${status}\n\nSome requested nodes do not exist. Nothing was shown; search for exact ids.`,
            isError: true,
          }
        const found = matches.map((match) => match!.node)
        const [focus] = found
        if (!focus)
          return { content: `${status}\n\nNone of those nodes exist in the map.`, isError: true }
        const lens = input.mode === 'lens'
        if (
          lens &&
          (found.length > MAX_TRAIL ||
            new Set(found.map((node) => node.id)).size !== found.length ||
            found.some((node) => !LENS_KINDS.has(node.kind)))
        )
          return {
            content: 'The lens accepts up to six source declarations, not files or directories.',
            isError: true,
          }
        showInView(index.root, sessionId, {
          scope: lens ? fileId(focus.path) : viewScopeOf(published.graph, focus.id),
          ...(lens ? { trail: found.map((node) => node.id) } : { focus: focus.id, trail: [] }),
          highlight: found.map((node) => node.id),
          camera: { kind: 'focus', nodes: found.map((node) => node.id) },
          requestedAt: Date.now(),
          ...(input.note ? { note: input.note } : {}),
        })
        return {
          content: `Requested ${lens ? 'source cards' : 'map highlights'} for ${found.length} node(s), starting at ${focus.name}. Use code_graph_view with kind: inspect to confirm what the tab shows.`,
          details: ctx.ui.offer({
            uri: graphUri(sessionId),
            label: 'Open Code Graph',
            description: input.note,
          }),
        }
      },
    }),
    createGraphViewTool(ctx),
  ]
}
