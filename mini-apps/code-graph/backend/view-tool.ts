import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'
import { graphCameraSchema } from '../shared/camera'
import { graphUri } from '../shared/resource'
import { nodeLine } from '../shared/format'
import {
  awaitGraphReportSince,
  awaitGraphView,
  readAgentView,
  readGraphView,
  requestGraphReport,
  showInView,
} from './agent-view'
import { projectIndex } from './indexing/projects'
import { findNode } from './refs'

/** Like Project Space's view tool, report the tab's applied camera, never a guessed viewport. */
export function createGraphViewTool(ctx: MiniAppContext) {
  return ctx.defineTool({
    name: 'code_graph_view',
    label: 'Read or move the Code Graph camera',
    activeVerb: 'Checking the code map view',
    description:
      'Read what this chat’s visible Code Graph tab actually shows, or move its camera. kind: inspect reads the current scope, call trail, selection, zoom and visible node ids; focus fits nodes already on this level; fit frames all; zoom sets 0.1–2.5 (1 is 100%); pan slides by screen fractions (x:0.5 is half a screen right); area frames a board rectangle. To navigate to another level or open source cards first use code_graph_show. This controls the view; graph nodes and edges are derived from source files, not editable board elements.',
    inputSchema: graphCameraSchema,
    executionMode: 'sequential',
    mutates: false,
    // Reading or moving the camera changes what the person sees, never anything durable.
    classify: () => ({ effect: 'view' }),
    behaviorHints: { readOnlyHint: true },
    permissionPaths: () => [],
    async execute(_id, input, _signal, _update, context) {
      const sessionId = context?.session?.id
      if (!sessionId)
        return { content: 'This run has no chat for a Code Graph view.', isError: true }
      const index = projectIndex(ctx.dataDir, ctx.cwd)
      const published = await index.ready(20_000)
      if (!published) return { content: 'The code map is not ready yet.', isError: true }
      let move = input
      if (input.kind === 'focus') {
        const found = input.nodes.map((ref) => findNode(published.graph, ref))
        if (found.some((match) => !match || match.note)) {
          return {
            content:
              'Focus targets are missing or ambiguous. Use exact ids from code_graph_search.',
            isError: true,
          }
        }
        move = { kind: 'focus', nodes: found.map((match) => match!.node.id) }
      }
      let report = readGraphView(index.root, sessionId)
      const pending = readAgentView(index.root, sessionId)
      if (
        input.kind === 'inspect' &&
        pending &&
        Date.now() - (pending.requestedAt ?? 0) < 15_000 &&
        report?.revision !== pending.revision
      ) {
        report = (await awaitGraphView(index.root, sessionId, pending.revision)) ?? undefined
      } else if (input.kind === 'inspect') {
        // The tab reports when asked, not every second: ask it now and read its answer. With no
        // tab on the stream, the stored report from its slow backstop is what there is.
        const asked = Date.now()
        if (requestGraphReport(index.root, sessionId)) {
          report = (await awaitGraphReportSince(index.root, sessionId, asked)) ?? report
        }
      }
      if (input.kind !== 'inspect') {
        const request = showInView(index.root, sessionId, {
          highlight: [],
          camera: move,
          requestedAt: Date.now(),
        })
        report = (await awaitGraphView(index.root, sessionId, request.revision)) ?? undefined
      }
      const details = {
        reveal: ctx.ui.offer({ uri: graphUri(sessionId), label: 'Open Code Graph' }),
      }
      if (!report)
        return {
          content:
            input.kind === 'inspect'
              ? 'No fresh report from this chat’s visible Code Graph tab. Give the user the App view link to open it, then inspect it.'
              : 'The camera request was queued, but the visible tab has not confirmed it. The requested move is not yet verified.',
          details,
        }
      const visible = report.visible
        .map((id) => published.graph.summary(id))
        .filter((node) => node !== null)
      return {
        content: [
          `Scope: ${report.scope}. Mode: ${report.trail.length ? 'lens' : 'map'}. Zoom: ${Math.round(report.viewport.zoom * 100)}%.`,
          `Selected: ${report.selected ?? 'none'}. Trail: ${report.trail.join(' → ') || 'none'}.`,
          `Viewport: ${JSON.stringify(report.viewport)}; size: ${JSON.stringify(report.size)}.`,
          ...(report.missing?.length
            ? [
                `Not on this level: ${report.missing.join(', ')}. Use code_graph_show to navigate there.`,
              ]
            : []),
          `Visible (${visible.length}):`,
          ...visible.slice(0, 50).map((node) => nodeLine(node!)),
          ...(visible.length > 50 ? ['…more visible nodes omitted'] : []),
        ].join('\n'),
        details,
      }
    },
  })
}
