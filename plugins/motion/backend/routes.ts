import { Hono } from 'hono'
import { z } from 'zod'
import { jsonBody, jsonError, type PluginRouteContext } from '@localixai/plugin-sdk/backend'
import { assetSchema, createSchema, idSchema, updateSchema } from '../shared/schema'
import { MotionError, createMotionService } from './service'

function matchesSignature(mime: string, bytes: Uint8Array) {
  const text = (start: number, end: number) => new TextDecoder().decode(bytes.subarray(start, end))
  if (mime === 'image/png') return bytes[0] === 137 && text(1, 4) === 'PNG'
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (mime === 'image/webp') return text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP'
  if (mime === 'audio/wav') return text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE'
  if (mime === 'audio/ogg') return text(0, 4) === 'OggS'
  return (
    mime === 'audio/mpeg' &&
    (text(0, 3) === 'ID3' || (bytes[0] === 255 && ((bytes[1] ?? 0) & 224) === 224))
  )
}
export function createMotionRoutes() {
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
          503,
          'motion_unavailable',
          'Motion Studio is temporarily unavailable. Try again.',
        ),
  )
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })
  const service = (c: { env: { cwd: string; sessionId?: string } }) => {
    if (!c.env.sessionId)
      throw new MotionError(
        'conflict',
        'Reopen Motion Studio from a conversation to use its workspace.',
      )
    return createMotionService(c.env.cwd)
  }
  app.get('/library', (c) =>
    service(c)
      .list()
      .then((state) => c.json(state)),
  )
  app.post('/projects', jsonBody(createSchema), async (c) => {
    const input = c.req.valid('json')
    return c.json(await service(c).create(input.template, input.title, input.document))
  })
  app.put('/projects/:id', jsonBody(updateSchema), async (c) => {
    const id = idSchema.safeParse(c.req.param('id'))
    if (!id.success) return jsonError(c, 400, 'invalid_id', 'Choose a saved video.')
    const input = c.req.valid('json')
    return c.json(await service(c).update(id.data, input.revision, input.document))
  })
  app.delete(
    '/projects/:id',
    jsonBody(z.strictObject({ revision: z.number().int().positive() })),
    async (c) => {
      const id = idSchema.safeParse(c.req.param('id'))
      if (!id.success) return jsonError(c, 400, 'invalid_id', 'Choose a saved video.')
      return c.json(await service(c).remove(id.data, c.req.valid('json').revision))
    },
  )
  // SDK JSON transport keeps authentication and a bounded payload; SVG/script assets are excluded.
  app.post(
    '/assets',
    jsonBody(
      z.strictObject({
        name: z.string().min(1).max(200),
        mime: assetSchema.shape.mime,
        base64: z
          .string()
          .min(1)
          .max(35 * 1024 * 1024),
      }),
    ),
    async (c) => {
      const input = c.req.valid('json')
      if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(input.base64))
        return jsonError(c, 400, 'invalid_asset', 'Choose a valid image or audio file.')
      const bytes = Buffer.from(input.base64, 'base64')
      if (bytes.byteLength > 25 * 1024 * 1024 || !matchesSignature(input.mime, bytes))
        return jsonError(
          c,
          400,
          'invalid_asset',
          'Use a PNG, JPEG, WebP, MP3, WAV or Ogg file under 25 MiB.',
        )
      return c.json(await service(c).upload(input.name, input.mime, bytes))
    },
  )
  app.get('/assets/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'))
    if (!id.success) return jsonError(c, 404, 'not_found', 'Media file not found.')
    const { asset, bytes } = await service(c).readAsset(id.data)
    c.header('Content-Type', asset.mime)
    c.header('X-Content-Type-Options', 'nosniff')
    return c.body(new Uint8Array(bytes))
  })
  app.delete('/assets/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'))
    if (!id.success) return jsonError(c, 404, 'not_found', 'Media file not found.')
    return c.json(await service(c).removeAsset(id.data))
  })
  return app
}
