import type { PluginProblem } from '@localixai/plugin-sdk/backend'

import { recordPluginProblem } from '../notifications/conditions/plugins'

/** Draw a plugin's problem on a chat's transcript. Supplied only where a session firehose
 *  exists to carry it (the per-run load), and only ever handed a problem that names a chat. */
export type PluginProblemSink = (
  pluginName: string,
  problem: PluginProblem & { sessionId: string },
) => void

/** What `makeContext` binds `ctx.reportProblem` to: see {@link pluginProblemReporter}. */
export type PluginProblemReporter = (pluginName: string, problem: PluginProblem) => void

/**
 * THE binding of `ctx.reportProblem` for every load that runs plugin code.
 *
 * The problem used to reach a person only as a transcript line, and only from the per-run load —
 * the one caller with a chat firehose — so a backend whose `register` found a broken config had no
 * way to say so at all, and a line in a chat nobody was watching was gone on reload. It is now
 * recorded as a standing condition first (the journal needs no chat), as the context's user, and
 * drawn on the transcript as well when it names a chat and the load has a firehose.
 *
 * Plugin inspection passes no reporter on purpose: reading a roster for Settings must not file
 * problems. The contract is fire-and-forget, so a failing sink never reaches the plugin.
 */
export function pluginProblemReporter(
  userId: string,
  session?: PluginProblemSink,
): PluginProblemReporter {
  return (pluginName, problem) => {
    try {
      recordPluginProblem(userId, pluginName, problem)
      if (session && problem.sessionId) {
        session(pluginName, { ...problem, sessionId: problem.sessionId })
      }
    } catch {
      /* a failed report must not fail the hook that made it */
    }
  }
}
