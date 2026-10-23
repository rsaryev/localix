import { Hono } from 'hono'
import { z } from 'zod'
import type { AppContext } from '../../app'
import { jsonError } from '../../lib/http'
import { zValidator } from '../../lib/validator'
import type { CapabilitySnapshot } from '../../contracts/capability-snapshot'
import { buildToolGcReport } from './gc-report'
import type { ToolUsageRecord } from './usage-repository'

/** Everything the GC report joins. Ports, so the route is testable without a DB or a plugin tree. */
export interface ToolGcSource {
  getSnapshot(input: {
    userId: string
    projectId?: string
    sessionId?: string
  }): Promise<CapabilitySnapshot>
  listUsage(userId: string, projectId: string): Promise<ToolUsageRecord[]>
  /** Resolved `toolBudgetWarn` for the scope, or null to take the default. */
  resolveWarnThreshold(userId: string, projectId: string): Promise<number | null>
  /** Injected so the age rules are testable; defaults to wall clock. */
  now?(): string
}

export { type ToolMeta } from './catalog'

/**
 * The tool routes are the GC report and nothing else.
 *
 * `GET /rpc/tools` used to serve the catalog as a MANIFEST — plugin tools folded in,
 * but with no idea about the scope's rules or a disabled owner. The capability
 * snapshot answers the same question with all of that resolved, so the manifest route
 * was a second, weaker truth about the same list and is gone.
 */
export function createToolsRoutes(gcSource?: ToolGcSource) {
  const app = new Hono<AppContext>()

  const routes = app.get(
    '/gc',
    zValidator(
      'query',
      z.object({ projectId: z.string().optional(), sessionId: z.string().optional() }),
    ),
    async (c) => {
      if (!gcSource) {
        return jsonError(c, 503, 'tool_usage_unavailable', 'Tool usage reporting is not available.')
      }
      const { projectId, sessionId } = c.req.valid('query')
      const userId = c.get('userId')
      const scope = projectId ?? ''
      const [snapshot, usage, warn] = await Promise.all([
        gcSource.getSnapshot({ userId, projectId, sessionId }),
        gcSource.listUsage(userId, scope),
        gcSource.resolveWarnThreshold(userId, scope).catch(() => null),
      ])
      return c.json(
        buildToolGcReport({
          snapshot,
          usage,
          warn,
          now: gcSource.now?.() ?? new Date().toISOString(),
        }),
      )
    },
  )

  return routes
}
