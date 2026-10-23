/**
 * Forge routes — GitHub over the `gh` CLI: the availability probe, open pull
 * requests, a PR's diff, and the browser create-PR flow.
 *
 * Their own module because they are their own SYSTEM. `gh` can be missing or
 * unauthenticated while git is perfectly available, so these degrade on their own
 * terms, and nothing here touches `SourceControlService`.
 */
import { Hono } from 'hono'
import type { MiniAppRouteContext as AppContext } from '@localixai/mini-app-sdk/backend'
import type { ForgeService } from '../forge/service'
import { prDiffQuerySchema, sessionQuerySchema } from '../requests'
import { validated } from './validated'

/** Host-neutral; only GitHub is wired in v1. */
export function createForgeRoutes(forge: ForgeService) {
  return new Hono<AppContext>()
    .get('/forge/status', validated('query', sessionQuerySchema), async (c) => {
      const { sessionId, repoRoot } = c.req.valid('query')
      return c.json(await forge.getStatus(c.env.userId, sessionId ?? null, repoRoot))
    })
    .get('/forge/prs', validated('query', sessionQuerySchema), async (c) => {
      const { sessionId, repoRoot } = c.req.valid('query')
      return c.json({
        prs: await forge.listPullRequests(c.env.userId, sessionId ?? null, repoRoot),
      })
    })
    .post('/forge/create-pr', validated('json', sessionQuerySchema), async (c) => {
      const { sessionId, repoRoot } = c.req.valid('json')
      return c.json(await forge.createPullRequestWeb(c.env.userId, sessionId ?? null, repoRoot))
    })
    .get('/forge/pr-diff', validated('query', prDiffQuerySchema), async (c) => {
      const { sessionId, number, repoRoot } = c.req.valid('query')
      return c.json(await forge.prDiff(c.env.userId, sessionId ?? null, number, repoRoot))
    })
}
