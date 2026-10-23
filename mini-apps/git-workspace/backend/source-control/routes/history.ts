/**
 * Routes that REWRITE history, plus the regression search that walks it: the
 * interactive-rebase family (compose a todo, reword, fixup, rebase onto,
 * continue / abort / skip) and bisect.
 *
 * Their own module because they are the operations that can leave the repository
 * in a paused, half-applied state — a stopped rebase or an open bisect — which is
 * why each one is paired with a banner in the header and a typed conflict code
 * rather than a plain failure.
 */
import { Hono } from 'hono'
import type { MiniAppRouteContext as AppContext } from '@localixai/mini-app-sdk/backend'
import type { SourceControlService } from '../service'
import {
  bisectMarkSchema,
  bisectStartSchema,
  fixupIntoSchema,
  interactiveRebaseSchema,
  rebaseOntoSchema,
  rewordSchema,
  sessionQuerySchema,
} from '../requests'
import { validated } from './validated'

export function createHistoryRoutes(service: SourceControlService) {
  return new Hono<AppContext>()
    .post('/rebase', validated('json', interactiveRebaseSchema), async (c) => {
      const { sessionId, fromHash, entries, repoRoot } = c.req.valid('json')
      return c.json(
        await service.interactiveRebase(
          c.env.userId,
          sessionId ?? null,
          fromHash,
          entries,
          repoRoot,
        ),
      )
    })
    .post('/reword', validated('json', rewordSchema), async (c) => {
      const { sessionId, hash, message, repoRoot } = c.req.valid('json')
      return c.json(
        await service.rewordCommit(c.env.userId, sessionId ?? null, hash, message, repoRoot),
      )
    })
    .post('/fixup-into', validated('json', fixupIntoSchema), async (c) => {
      const { sessionId, hash, repoRoot } = c.req.valid('json')
      return c.json(await service.fixupInto(c.env.userId, sessionId ?? null, hash, repoRoot))
    })
    .post('/rebase-onto', validated('json', rebaseOntoSchema), async (c) => {
      const { sessionId, base, repoRoot } = c.req.valid('json')
      return c.json(await service.rebaseOnto(c.env.userId, sessionId ?? null, base, repoRoot))
    })
    .post('/rebase-continue', validated('json', sessionQuerySchema), async (c) => {
      const { sessionId, repoRoot } = c.req.valid('json')
      return c.json(await service.rebaseContinue(c.env.userId, sessionId ?? null, repoRoot))
    })
    .post('/rebase-abort', validated('json', sessionQuerySchema), async (c) => {
      const { sessionId, repoRoot } = c.req.valid('json')
      return c.json(await service.rebaseAbort(c.env.userId, sessionId ?? null, repoRoot))
    })
    .post('/rebase-skip', validated('json', sessionQuerySchema), async (c) => {
      const { sessionId, repoRoot } = c.req.valid('json')
      return c.json(await service.rebaseSkip(c.env.userId, sessionId ?? null, repoRoot))
    })
    .post('/bisect/start', validated('json', bisectStartSchema), async (c) => {
      const { sessionId, hash, good, repoRoot } = c.req.valid('json')
      return c.json(
        await service.bisectStart(c.env.userId, sessionId ?? null, hash, good, repoRoot),
      )
    })
    .post('/bisect/mark', validated('json', bisectMarkSchema), async (c) => {
      const { sessionId, term, repoRoot } = c.req.valid('json')
      return c.json(await service.bisectMark(c.env.userId, sessionId ?? null, term, repoRoot))
    })
    .post('/bisect/reset', validated('json', sessionQuerySchema), async (c) => {
      const { sessionId, repoRoot } = c.req.valid('json')
      return c.json(await service.bisectReset(c.env.userId, sessionId ?? null, repoRoot))
    })
}
