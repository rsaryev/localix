import { Hono } from 'hono'
import { z } from 'zod'

import type { AppContext } from '../../app'
import { defaultErrorHandler } from '../../lib/http'
import { zValidator } from '../../lib/validator'
import { describeClaudeCodePermissions } from './permissions-view'

/**
 * Read-only views of the person's Claude Code settings files, for Settings to show what applies
 * on top of Localix's own configuration. Nothing here writes a Claude Code file.
 */
export interface ClaudeCodeSettingsRoutesPorts {
  /** The project's working directory, or null for none (the person's own files only). */
  workingDir(userId: string, projectId: string): Promise<string | null>
  homeDir: string
}

export function createClaudeCodeSettingsRoutes(ports: ClaudeCodeSettingsRoutesPorts) {
  const app = new Hono<AppContext>()

  const routes = app.get(
    '/permissions',
    zValidator('query', z.object({ projectId: z.string().min(1).optional() })),
    async (c) => {
      const { projectId } = c.req.valid('query')
      const cwd = projectId ? await ports.workingDir(c.get('userId'), projectId) : null
      return c.json(await describeClaudeCodePermissions({ homeDir: ports.homeDir, cwd }), 200)
    },
  )

  routes.onError(defaultErrorHandler)
  return routes
}
