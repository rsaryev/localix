import { Hono } from 'hono'
import { z } from 'zod'
import type { AppContext } from '../../app'
import { NotFoundError } from '../../lib/domain-errors'
import { zValidator } from '../../lib/validator'
import type { ModsHost } from './host'

/**
 * The screen side of mods: which panes are open (each a mod instance's, in one project), what a
 * pane draws, and the controls a person uses in it. Clients re-read on the `mods` topic, which the host pokes when a mod opens or closes
 * a pane or asks for a redraw.
 */

const viewportQuery = z.object({
  columns: z.coerce.number().int().min(20).max(400).optional(),
  rows: z.coerce.number().int().min(4).max(400).optional(),
})

const takenBody = z.object({
  fills: z.array(z.string().max(100)).max(50).optional(),
  suggestion: z.boolean().optional(),
})

const clientQuery = z.object({ module: z.string().min(1).max(10_000) })
// Bounded again where it is read: plain data within a tree's bounds (`plainDataProblem`).
const messageBody = z.object({ data: z.unknown() })
const faultBody = z.object({
  phase: z.enum(['load', 'render', 'run']),
  reason: z.string().max(4096),
})

const actionBody = z.object({
  kind: z.enum(['press', 'input', 'submit', 'select']),
  element: z.string().min(1).max(200),
  value: z.string().max(100_000).optional(),
})

export function createModRoutes(
  host: ModsHost,
  /** A client opened a conversation's prompt box: Claude Code's status line draws for it. */
  options: { sessionViewed?: (userId: string, sessionId: string) => void } = {},
) {
  return (
    new Hono<AppContext>()
      .get('/', (c) =>
        c.json({
          mods: host.loaded(),
          panes: host.registry.panes().map(({ instance, plugin, id, title }) => ({
            instance,
            plugin,
            id,
            title,
            // The project the pane belongs to: a mod runs once per working directory.
            cwd: host.instances().get(instance)?.cwd ?? null,
          })),
          failures: Object.fromEntries(host.failures()),
        }),
      )
      // A conversation's prompt box and status line as its mods left them.
      .get('/sessions/:sessionId', (c) => {
        options.sessionViewed?.(c.get('userId'), c.req.param('sessionId'))
        return c.json(host.composer.view(c.req.param('sessionId')))
      })
      .post('/sessions/:sessionId/taken', zValidator('json', takenBody), (c) => {
        host.composer.take(c.req.param('sessionId'), c.req.valid('json'))
        return c.json({ ok: true })
      })
      .get('/panes/:instance/:id', zValidator('query', viewportQuery), async (c) => {
        const { columns, rows } = c.req.valid('query')
        const drawing = await host.panes.render(c.req.param('instance'), c.req.param('id'), {
          columns: columns ?? 100,
          rows: rows ?? 40,
        })
        if (!drawing) throw new NotFoundError('mod_pane_not_found', 'No such pane is open')
        return c.json(drawing)
      })
      .post('/panes/:instance/:id/actions', zValidator('json', actionBody), async (c) => {
        const handled = await host.panes.interact(
          c.req.param('instance'),
          c.req.param('id'),
          c.req.valid('json'),
        )
        if (!handled) throw new NotFoundError('mod_control_gone', 'That control is no longer drawn')
        return c.json({ ok: true })
      })
      // A `Client`'s surface module, bundled at load; the screen runs it in an isolated frame.
      .get('/clients/:instance', zValidator('query', clientQuery), (c) => {
        const { module } = c.req.valid('query')
        const bundle = host.clientModule(c.req.param('instance'), module)
        if (!bundle) throw new NotFoundError('mod_client_not_found', 'No such surface module')
        return c.json({ module, ...bundle })
      })
      .post(
        '/panes/:instance/:id/clients/:key/messages',
        zValidator('json', messageBody),
        async (c) => {
          const { instance, id, key } = c.req.param()
          const answer = await host.panes.message(instance, id, key, c.req.valid('json').data)
          if (!answer) throw new NotFoundError('mod_client_gone', 'That Client is no longer drawn')
          return c.json(answer)
        },
      )
      .post(
        '/panes/:instance/:id/clients/:key/faults',
        zValidator('json', faultBody),
        async (c) => {
          const { instance, id, key } = c.req.param()
          const heard = await host.panes.fault(instance, id, key, c.req.valid('json'))
          if (!heard) throw new NotFoundError('mod_client_gone', 'That Client is no longer drawn')
          return c.json({ ok: true })
        },
      )
      .delete('/panes/:instance/:id', async (c) => {
        await host.panes.close(c.req.param('instance'), c.req.param('id'))
        return c.json({ ok: true })
      })
  )
}
