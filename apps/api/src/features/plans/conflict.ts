/**
 * A DECISION THAT MET A VERSION ALREADY DECIDED — and the versions as they are now.
 *
 * The defect it stops: a client whose list had missed a `plan.updated` frame still
 * showed v1 waiting with Approve; every click answered a bare 409 "already approved", a red error,
 * and the list stayed stale, because nothing in the answer said what the versions WERE. So the
 * conflict carries the conversation's full list, and the routes put it beside the error
 * (`{ error, plans }`): the client applies it through the same reducer as the frame and the
 * strip corrects itself on the first click.
 */
import { ApiError } from '../../lib/errors'
import type { SessionPlan } from './contracts'

export class PlanConflictError extends ApiError {
  readonly plans: SessionPlan[]

  constructor(code: string, message: string, plans: SessionPlan[]) {
    super(409, code, message)
    this.name = 'PlanConflictError'
    this.plans = plans
  }
}

export const isPlanConflict = (error: unknown): error is PlanConflictError =>
  error instanceof PlanConflictError
