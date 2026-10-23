import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { jsonBody, jsonError, type MiniAppRouteContext } from '@localixai/mini-app-sdk/backend'
import { spaceOpsSchema } from '../shared/ops/contract'
import { cameraHub } from './camera-hub'
import { mayRead, resolveReference } from './paths'
import { keepPastedFile, listFolder, referenceStates } from './references'
import { SpaceRefusal, spaceStore, type SpaceSnapshot } from './space-store'

/**
 * The view's routes: a person's hand on the project's board. The board is the project the chat
 * works in — `c.env.cwd`, resolved by the host from the chat the view names — so a request
 * never names a path of its own for the board, only for the files the board references, and
 * those pass `mayRead` first.
 */
const PASTE_LIMIT = 25 * 1024 * 1024
const TEXT_LIMIT = 64 * 1024

const opsBody = z.object({ ops: spaceOpsSchema })
const finite = z.number().refine(Number.isFinite)
const reportBody = z.object({
  seq: z.number().int().positive(),
  viewport: z.object({ x: finite, y: finite, zoom: finite.refine((zoom) => zoom > 0) }),
  size: z.object({ width: finite, height: finite }),
})

export function createSpaceRoutes({ liveUpdates = false }: { liveUpdates?: boolean } = {}) {
  const answer = async <T>(
    c: Context<MiniAppRouteContext>,
    action: (root: string) => Promise<T>,
  ) => {
    try {
      c.header('Cache-Control', 'no-store')
      return c.json(await action(c.env.cwd))
    } catch (error) {
      if (error instanceof SpaceRefusal)
        return jsonError(c, error.status, error.code, error.message)
      return jsonError(
        c,
        503,
        'space_unavailable',
        'The board could not be read or saved. Try again.',
      )
    }
  }
  const withMissing = async (root: string, snapshot: SpaceSnapshot) => ({
    ...snapshot,
    liveUpdates,
    ...(await referenceStates(root, snapshot.space)),
  })
  /** The absolute path of a board reference this route may read, or a refusal. */
  const readable = async (c: Context<MiniAppRouteContext>) => {
    const path = c.req.query('path') ?? ''
    const target = resolveReference(c.env.cwd, path)
    const { space } = await spaceStore.read(c.env.cwd)
    if (!target || !mayRead(c.env.cwd, space, target))
      throw new SpaceRefusal(
        404,
        'not_on_board',
        `"${path}" is neither in the project nor on the board.`,
      )
    return target
  }

  return (
    new Hono<MiniAppRouteContext>()
      .get('/space', (c) =>
        answer(c, async (root) => withMissing(root, await spaceStore.read(root))),
      )
      .post('/ops', jsonBody(opsBody), (c) =>
        answer(c, async (root) => {
          const { snapshot, results } = await spaceStore.apply(
            root,
            c.req.valid('json').ops,
            'user',
          )
          return { ...(await withMissing(root, snapshot)), results }
        }),
      )
      .post('/undo', (c) =>
        answer(c, async (root) => {
          const { snapshot, conflicts } = await spaceStore.step(root, 0, 'user')
          return { ...(await withMissing(root, snapshot)), conflicts }
        }),
      )
      .post('/redo', (c) =>
        answer(c, async (root) => {
          const { snapshot, conflicts } = await spaceStore.step(root, 1, 'user')
          return { ...(await withMissing(root, snapshot)), conflicts }
        }),
      )
      // A pasted file has no path: its bytes are kept beside the board and referenced like any file.
      .post('/files', (c) =>
        answer(c, async (root) => {
          const bytes = new Uint8Array(await c.req.arrayBuffer())
          if (bytes.byteLength === 0 || bytes.byteLength > PASTE_LIMIT)
            throw new SpaceRefusal(
              400,
              'paste_size',
              'A pasted file must be between 1 byte and 25 MB.',
            )
          return { path: await keepPastedFile(root, c.req.query('name') || 'pasted', bytes) }
        }),
      )
      .get('/raw', async (c) => {
        try {
          const file = Bun.file(await readable(c))
          if (!(await file.exists())) return jsonError(c, 404, 'missing', 'The file is not there.')
          return new Response(file, {
            headers: { 'Content-Type': file.type, 'Cache-Control': 'private, max-age=5' },
          })
        } catch (error) {
          if (error instanceof SpaceRefusal)
            return jsonError(c, error.status, error.code, error.message)
          throw error
        }
      })
      .get('/text', (c) =>
        answer(c, async () => {
          const file = Bun.file(await readable(c))
          if (!(await file.exists()))
            throw new SpaceRefusal(404, 'missing', 'The file is not there.')
          const head = new Uint8Array(await file.slice(0, TEXT_LIMIT).arrayBuffer())
          // A NUL in the first bytes is a binary file; a card shows its name, not its bytes.
          if (head.includes(0)) return { text: null, binary: true, truncated: false }
          return {
            text: new TextDecoder().decode(head),
            binary: false,
            truncated: file.size > TEXT_LIMIT,
          }
        }),
      )
      .get('/folder', (c) => answer(c, async () => listFolder(await readable(c))))
      // The tab's answer to the agent's camera move, pushed to it on its stream (`camera-hub.ts`).
      .post('/camera/report', jsonBody(reportBody), (c) => {
        cameraHub.report(c.req.query('sessionId') ?? '', c.req.valid('json'))
        return c.json({ ok: true })
      })
  )
}
