import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import { z } from 'zod'
import type { AppContext } from '../../app'
import { defaultErrorHandler } from '../../lib/http'
import { createTerminalRequestSchema, spawnTerminalRequestSchema } from './contracts'
import type { TerminalService } from './service'
import type { WorkRegistry } from '../work/registry'
import { recordTerminalWork } from './terminal-work'

/** REST surface for terminal lifecycle; the I/O stream rides the WS route (ws.ts). */
export function createTerminalRoutes(service: TerminalService, work: WorkRegistry) {
  const app = new Hono<AppContext>()

  const routes = app
    .post('/', zValidator('json', createTerminalRequestSchema), async (c) => {
      const info = await service.open(c.get('userId'), c.req.valid('json'))
      return c.json(info, 201)
    })
    // Run a command in a PTY pane (e.g. the preview panel relaunching a stopped dev
    // server). The UI adopts the returned terminalId to surface logs on demand.
    .post('/spawn', zValidator('json', spawnTerminalRequestSchema), async (c) => {
      const input = c.req.valid('json')
      const userId = c.get('userId')
      const session = await service.spawnCommand(userId, input)
      // A server started from the preview, a mini app, or by hand is the session's background
      // work as much as an agent's job is — without a record the composer, which lists work,
      // would not show it. Agent bash jobs are recorded by the runner; the agent's interactive
      // panes by the terminal port, through this same `recordTerminalWork`.
      recordTerminalWork(work, {
        owner: { userId, sessionId: input.sessionId },
        agentId: null,
        label: input.command,
        terminal: session,
      })
      return c.json({ terminalId: session.id, cwd: session.cwd }, 201)
    })
    .get('/', (c) => c.json(service.list(c.get('userId')), 200))
    .delete('/:id', zValidator('param', z.object({ id: z.string() })), (c) => {
      const ok = service.close(c.get('userId'), c.req.valid('param').id)
      return c.json({ ok }, ok ? 200 : 404)
    })

  routes.onError(defaultErrorHandler)

  return routes
}
