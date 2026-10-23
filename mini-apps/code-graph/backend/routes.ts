import { Hono } from 'hono'
import { z } from 'zod'
import { jsonBody, jsonError, type MiniAppRouteContext } from '@localixai/mini-app-sdk/backend'
import { clearAgentView, reportGraphView } from './agent-view'
import { graphCameraReportSchema } from '../shared/camera'
import { projectIndex } from './indexing/projects'
import { MAX_TRAIL } from '../shared/lens'
import { buildSnapshot, type ViewQuery } from './snapshot'

/**
 * The view's routes. Every one answers with the full snapshot for the query it was sent with, so
 * an action (reindex, dismiss the agent's highlight) shows its result without a second request.
 *
 * The project is the request's own: `c.env.cwd` is resolved per call from the chat the view
 * belongs to, never captured when the mini app loaded — a backend loaded once would otherwise keep
 * mapping the first project it saw after the person switched chats.
 */
export function createGraphRoutes(dataDir: string) {
  const indexOf = (cwd: string) => projectIndex(dataDir, cwd)
  const queryOf = (url: string): ViewQuery => {
    const params = new URL(url).searchParams
    const text = (name: string) => params.get(name)?.trim().slice(0, 500) || undefined
    // Up to six ids, each a path plus a qualified name: its own, larger bound.
    const trail = (params.get('trail')?.slice(0, 4000) ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, MAX_TRAIL)
    return {
      sessionId: text('sessionId'),
      scope: text('scope'),
      node: text('node'),
      q: text('q'),
      external: params.get('external') === '1',
      live: params.get('live') === '1',
      ...(trail.length > 0 ? { trail } : {}),
    }
  }
  const answer = async (context: Parameters<typeof jsonError>[0], cwd: string, url: string) => {
    context.header('Cache-Control', 'no-store')
    try {
      return context.json(await buildSnapshot(indexOf(cwd), queryOf(url)))
    } catch {
      return jsonError(
        context,
        503,
        'code_graph_unavailable',
        'The code map is temporarily unavailable.',
      )
    }
  }

  // The actions carry no fields, but still arrive as JSON: `jsonBody` refuses a body that did not,
  // which is what keeps a plain cross-site form post from reaching them.
  const noFields = jsonBody(z.object({}))
  return new Hono<MiniAppRouteContext>()
    .get('/view', (context) => answer(context, context.env.cwd, context.req.url))
    .post('/reindex', noFields, (context) => {
      void indexOf(context.env.cwd).refresh()
      return answer(context, context.env.cwd, context.req.url)
    })
    .post('/changed', noFields, (context) => {
      // The tab heard that the project's files changed. Answers at once and without a snapshot:
      // the refresh runs in the background, and its end reaches the tab as a `revision` frame.
      indexOf(context.env.cwd).changed()
      return context.json({ ok: true })
    })
    .post('/agent/clear', noFields, async (context) => {
      const sessionId = context.req.query('sessionId')
      if (!sessionId) return jsonError(context, 400, 'missing_session', 'A chat is required.')
      clearAgentView(indexOf(context.env.cwd).root, sessionId)
      return answer(context, context.env.cwd, context.req.url)
    })
    .post('/camera/report', jsonBody(graphCameraReportSchema), (context) => {
      const sessionId = context.req.query('sessionId')
      if (!sessionId) return jsonError(context, 400, 'missing_session', 'A chat is required.')
      reportGraphView(indexOf(context.env.cwd).root, sessionId, context.req.valid('json'))
      return context.json({ ok: true })
    })
}
