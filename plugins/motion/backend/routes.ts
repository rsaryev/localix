import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import { jsonBody, jsonError, type PluginRouteContext } from '@localixai/plugin-sdk/backend'
import { createSchema, renderSchema, snapshotSchema } from '../shared/contract'
import { styleById } from '../shared/styles'
import { projectDirectory } from './files'
import { cancelJob, startJob } from './jobs'
import { libraryOf, type Scope } from './library'
import { MotionError, createProject, removeProject } from './projects'
import { serveDirectionFile, serveStylePreview } from './previews'
import { serveProjectFile, verifyView } from './view'

export type ResolveWorkspace = (userId: string, sessionId: string) => Promise<string | null>
type Env = { userId: string; sessionId?: string; cwd: string }

export const renderArgs = (input: { quality: string; format: string }, id: string) => [
  'render',
  '--quality',
  { draft: 'draft', standard: 'looks', high: 'delivery' }[input.quality] ?? 'looks',
  '--format',
  input.format,
  '--output',
  `renders/${id}-${new Date().toISOString().replace(/[:.]/gu, '-').slice(0, 19)}.${input.format}`,
]
export const snapshotArgs = (at?: number[]) => [
  'snapshot',
  '.',
  ...(at?.length ? ['--at', at.map((t) => t.toFixed(2)).join(',')] : ['--frames', '8']),
  '--output',
  'snapshots',
  '--describe',
  'false',
]

/** Snapshots replace the previous set, so the folder always shows one coherent review. */
export async function startSnapshot(folder: string, at?: number[]) {
  await rm(join(folder, 'snapshots'), { recursive: true, force: true })
  return startJob(folder, 'snapshot', snapshotArgs(at))
}

/**
 * `resolveWorkspace` maps a conversation to its workspace for the signed `/view` paths, which
 * carry the session in the path (a player iframe cannot add a query string to relative URLs).
 * Without it (the standalone preview) every route uses the request's own `cwd`.
 */
export function createMotionRoutes(resolveWorkspace?: ResolveWorkspace) {
  const app = new Hono<PluginRouteContext>()
  app.onError((error, c) =>
    error instanceof MotionError
      ? jsonError(
          c,
          error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400,
          error.code,
          error.message,
        )
      : jsonError(
          c,
          400,
          'motion_failed',
          error instanceof Error ? error.message : 'Motion Studio failed. Try again.',
        ),
  )
  const scope = (c: { env: Env }): Scope => {
    if (!c.env.sessionId)
      throw new MotionError(
        'conflict',
        'Reopen Motion Studio from a conversation to use its workspace.',
      )
    return { userId: c.env.userId, sessionId: c.env.sessionId, workspace: c.env.cwd }
  }
  const folderOf = async (s: Scope, id: string) => {
    const folder = await projectDirectory(s.workspace, id)
    if (!folder) throw new MotionError('not_found', 'This film no longer exists.')
    return folder
  }
  app.get('/view/:session/:id/:signature/*', async (c) => {
    const { session, id, signature } = c.req.param()
    const env = c.env as Env
    if (!verifyView(env.userId, session, id, signature)) return c.text('Not found', 404)
    const workspace = resolveWorkspace ? await resolveWorkspace(env.userId, session) : env.cwd
    const folder = workspace ? await projectDirectory(workspace, id) : null
    const prefix = `/view/${encodeURIComponent(session)}/${id}/${signature}/`
    const path = decodeURIComponent(new URL(c.req.url).pathname.split(prefix)[1] ?? '')
    const response = folder ? await serveProjectFile(folder, path) : null
    return response ?? c.text('Not found', 404)
  })
  app.get('/directions/:id/*', async (c) => {
    const id = c.req.param('id')
    const path = decodeURIComponent(
      new URL(c.req.url).pathname.split(`/directions/${id}/`)[1] ?? '',
    )
    return (await serveDirectionFile(id, path)) ?? c.text('Not found', 404)
  })
  app.get(
    '/styles/:id/preview.jpg',
    async (c) => (await serveStylePreview(c.req.param('id'))) ?? c.text('Not found', 404),
  )
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })
  app.get('/library', async (c) => c.json(await libraryOf(scope(c))))
  // “Use direction”: fork the direction's film into this conversation's workspace.
  app.post('/projects', jsonBody(createSchema), async (c) => {
    const s = scope(c)
    const input = c.req.valid('json')
    const direction = styleById(input.direction)
    if (!direction) throw new MotionError('not_found', 'Unknown direction.')
    const id = await createProject(s.workspace, {
      title: input.title ?? direction.name,
      direction: direction.id,
    })
    return c.json(await libraryOf(s, id))
  })
  app.delete('/projects/:id', async (c) => {
    const s = scope(c)
    await removeProject(s.workspace, c.req.param('id'))
    return c.json(await libraryOf(s))
  })
  app.post('/projects/:id/render', jsonBody(renderSchema), async (c) => {
    const s = scope(c)
    const id = c.req.param('id')
    startJob(await folderOf(s, id), 'render', renderArgs(c.req.valid('json'), id))
    return c.json(await libraryOf(s))
  })
  app.post('/projects/:id/snapshot', jsonBody(snapshotSchema), async (c) => {
    const s = scope(c)
    await startSnapshot(await folderOf(s, c.req.param('id')), c.req.valid('json').at)
    return c.json(await libraryOf(s))
  })
  app.post('/projects/:id/cancel', async (c) => {
    const s = scope(c)
    cancelJob(await folderOf(s, c.req.param('id')))
    return c.json(await libraryOf(s))
  })
  return app
}
