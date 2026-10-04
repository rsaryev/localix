import { createTwoFilesPatch } from 'diff'
import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'

import type { AppContext } from '../../app'
import { defaultErrorHandler } from '../../lib/http'
import {
  compositionQuerySchema,
  promptDiffQuerySchema,
  effectiveConfigQuerySchema,
  effectiveConfigReportSchema,
} from './contracts'
import { getComposition } from './composition-store'
import { promptTexts } from './prompt-texts'
import type { AgentConfigurationService } from './service'

/**
 * READ-ONLY effective-agent-configuration diagnostics. Resolves the settings the
 * runtime actually applies for a scope (user → project → session/mode, env
 * tightening) and reports resolved values + per-key provenance + reload class +
 * cross-field validation warnings + resolved model per consumer. Never mutates
 * state; never returns a secret value, connection credential, or raw system prompt.
 */
export interface EffectiveConfigRoutesService {
  getEffective: AgentConfigurationService['getEffective']
}

export function createEffectiveConfigRoutes(service: EffectiveConfigRoutesService) {
  const app = new Hono<AppContext>()

  const routes = app.get('/', zValidator('query', effectiveConfigQuerySchema), async (c) => {
    const { projectId, sessionId } = c.req.valid('query')
    const report = await service.getEffective({
      userId: c.get('userId'),
      projectId,
      sessionId,
    })
    return c.json(effectiveConfigReportSchema.parse(report), 200)
  })

  /**
   * What the session's most recent run actually loaded, and who contributed it.
   *
   * Read-only in the strict sense: it reports a snapshot the run recorded rather than
   * assembling a roster now, because assembling one gathers MCP servers — a diagnostics
   * read must not open outbound connections. Before a session's first run there is nothing
   * to report, and that is answered as such instead of being invented.
   */
  routes.get('/composition', zValidator('query', compositionQuerySchema), (c) => {
    const { sessionId } = c.req.valid('query')
    const snapshot = getComposition(sessionId)
    if (!snapshot) {
      return c.json(
        { status: 'unavailable' as const, reason: 'this session has not completed a run yet' },
        200,
      )
    }
    return c.json(
      {
        status: 'ready' as const,
        recordedAt: new Date(snapshot.at).toISOString(),
        ...snapshot.report,
      },
      200,
    )
  })

  /**
   * What changed between two prompt-cache hashes.
   *
   * The snapshot already reports WHICH field moved between turns; this answers what moved
   * inside it, which is the difference between knowing the stable prefix busted and knowing
   * which token busted it — the most expensive quiet regression this system has.
   *
   * Both texts are retained only under LOCALIX_CACHE_DIAGNOSTICS, in a bounded process-local
   * store, so a hash this process never saw (or has since evicted) is answered as unavailable
   * rather than guessed at.
   */
  routes.get('/prompt-diff', zValidator('query', promptDiffQuerySchema), (c) => {
    const { from, to } = c.req.valid('query')
    const before = promptTexts.get(from)
    const after = promptTexts.get(to)
    const missing = [...(before === undefined ? [from] : []), ...(after === undefined ? [to] : [])]
    if (before === undefined || after === undefined) {
      return c.json(
        {
          status: 'unavailable' as const,
          missing,
          reason:
            'no retained text for these hashes — run with LOCALIX_CACHE_DIAGNOSTICS, and note the store is bounded and process-local',
        },
        200,
      )
    }
    if (before === after) {
      // Equal text under different hashes would mean the hash function disagreed with itself,
      // so say so plainly rather than returning an empty diff that reads as "nothing changed".
      return c.json({ status: 'identical' as const, from, to }, 200)
    }
    return c.json(
      {
        status: 'ready' as const,
        from,
        to,
        diff: createTwoFilesPatch(`${from}.txt`, `${to}.txt`, before, after, undefined, undefined, {
          context: 3,
        }),
      },
      200,
    )
  })

  routes.onError(defaultErrorHandler)
  return routes
}
