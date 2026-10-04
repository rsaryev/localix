import { Hono } from 'hono'

import { defaultErrorHandler } from '../../lib/http'
import type { AppContext } from '../../app'
import { shellCommandStatusSchema } from './contracts'
import type { ShellCommandService } from './service'

/**
 * `localix` shell-command install controls ("install in PATH").
 *   GET  /rpc/shell-command            → current install status
 *   POST /rpc/shell-command/install    → write the launcher into a user bin dir
 *   POST /rpc/shell-command/uninstall  → remove it
 */
export function createShellCommandRoutes(service: ShellCommandService) {
  const app = new Hono<AppContext>()

  const routes = app
    .get('/', async (c) => c.json(shellCommandStatusSchema.parse(await service.status()), 200))
    .post('/install', async (c) =>
      c.json(shellCommandStatusSchema.parse(await service.install()), 200),
    )
    .post('/uninstall', async (c) =>
      c.json(shellCommandStatusSchema.parse(await service.uninstall()), 200),
    )

  routes.onError(defaultErrorHandler)
  return routes
}
