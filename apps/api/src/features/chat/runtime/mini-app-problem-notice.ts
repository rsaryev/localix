import type { AgentStreamEvent } from '../contracts/stream'

/** A mini app's `ctx.reportProblem`, once the host has bound who reported it and for whom. */
export interface MiniAppProblemInput {
  sessionId: string
  app: string
  message: string
  detail?: string
  source?: string
}

type HookNotice = Extract<AgentStreamEvent, { type: 'hook.notice' }>

/**
 * The `hook.notice` frame a mini app's problem rides.
 *
 * `hookEvent` is the transcript line's text (`<app> · <where>`), and was once the only place the
 * app was named — so the client could neither tell an app's problem from a Claude Code hook's
 * remark, nor recover which app it was without parsing display text. `miniApp` carries both as
 * data: its presence is the discriminator, and its name keys the standing Event Center row.
 */
export function miniAppProblemNotice(problem: MiniAppProblemInput): HookNotice {
  return {
    type: 'hook.notice',
    sessionId: problem.sessionId,
    message: problem.message,
    hookEvent: problem.source ? `${problem.app} · ${problem.source}` : problem.app,
    ...(problem.detail ? { detail: problem.detail } : {}),
    miniApp: { name: problem.app, ...(problem.source ? { source: problem.source } : {}) },
  }
}
