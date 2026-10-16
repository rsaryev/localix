/**
 * The person's side of a conversation's shared state, mounted under `/rpc` as one group: its plan
 * and the decisions on it, the work the agent stopped on (Continue), everything waiting on the
 * person, and review comments.
 *
 * One module because these four grow together — each new lifecycle step adds a route here, not a
 * line to `app.ts`, which is the composition of the whole API and was outgrowing its size pin one
 * conversation feature at a time.
 */
import { Hono } from 'hono'

import type { AppContext } from './app'
import { createAttentionRoutes } from './features/attention/routes'
import type { AttentionRegistry } from './features/attention/registry'
import { createCommentRoutes } from './features/comments/routes'
import type { CommentRepository } from './features/comments/repository'
import { createPlanRoutes } from './features/plans/routes'
import type { PlanService } from './features/plans/service'
import { createResumeRoutes } from './features/resume/routes'
import type { ResumeRegistry } from './features/resume/registry'

export interface ConversationRouteDeps {
  /** The conversation's plan versions and the person's decisions on them. */
  plans: PlanService
  /** "Continue" on the conversation's unfinished work (`features/resume`). */
  resume: ResumeRegistry
  comments: CommentRepository
  /** Everything waiting on the person, across their sessions (`features/attention`). */
  attention: Pick<AttentionRegistry, 'list'>
}

export function createConversationRoutes(deps: ConversationRouteDeps) {
  return new Hono<AppContext>()
    .route('/', createPlanRoutes(deps.plans))
    .route('/', createResumeRoutes(deps.resume))
    .route('/attention', createAttentionRoutes(deps.attention))
    .route('/comments', createCommentRoutes(deps.comments))
}
