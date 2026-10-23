import type { MiniAppProblem } from '@localixai/mini-app-sdk/backend'

import { recordMiniAppProblem } from '../notifications/conditions/mini-apps'

/** Draw a mini app's problem on a chat's transcript. Supplied only where a session firehose
 *  exists to carry it (the per-run load), and only ever handed a problem that names a chat. */
export type MiniAppProblemSink = (
  miniAppName: string,
  problem: MiniAppProblem & { sessionId: string },
) => void

/** What `makeContext` binds `ctx.reportProblem` to: see {@link miniAppProblemReporter}. */
export type MiniAppProblemReporter = (miniAppName: string, problem: MiniAppProblem) => void

/**
 * THE binding of `ctx.reportProblem` for every load that runs mini app code.
 *
 * The problem used to reach a person only as a transcript line, and only from the per-run load —
 * the one caller with a chat firehose — so a backend whose `register` found a broken config had no
 * way to say so at all, and a line in a chat nobody was watching was gone on reload. It is now
 * recorded as a standing condition first (the journal needs no chat), as the context's user, and
 * drawn on the transcript as well when it names a chat and the load has a firehose.
 *
 * Mini app inspection passes no reporter on purpose: reading a roster for Settings must not file
 * problems. The contract is fire-and-forget,  so a failing sink never reaches the app.
 */
export function miniAppProblemReporter(
  userId: string,
  session?: MiniAppProblemSink,
): MiniAppProblemReporter {
  return (app, problem) => {
    try {
      recordMiniAppProblem(userId, app, problem)
      if (session && problem.sessionId) {
        session(app, { ...problem, sessionId: problem.sessionId })
      }
    } catch {
      /* a failed report must not fail the hook that made it */
    }
  }
}
