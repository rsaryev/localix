import type { AgentStreamEvent } from '../contracts/stream'

/** A plugin's `ctx.reportProblem`, once the host has bound who reported it and for whom. */
export interface MiniAppProblemInput {
  sessionId: string
  pluginName: string
  message: string
  detail?: string
  source?: string
}

type HookNotice = Extract<AgentStreamEvent, { type: 'hook.notice' }>

/**
 * The `hook.notice` frame a plugin's problem rides.
 *
 * `hookEvent` is the transcript line's text (`<plugin> · <where>`), and was once the only place the
 * plugin was named — so the client could neither tell a plugin's problem from a Claude Code hook's
 * remark, nor recover which plugin it was without parsing display text. `plugin` carries both as
 * data: its presence is the discriminator, and its name keys the standing Event Center row.
 */
export function miniAppProblemNotice(problem: MiniAppProblemInput): HookNotice {
  return {
    type: 'hook.notice',
    sessionId: problem.sessionId,
    message: problem.message,
    hookEvent: problem.source ? `${problem.pluginName} · ${problem.source}` : problem.pluginName,
    ...(problem.detail ? { detail: problem.detail } : {}),
    plugin: { name: problem.pluginName, ...(problem.source ? { source: problem.source } : {}) },
  }
}
