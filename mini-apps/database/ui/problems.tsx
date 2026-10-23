/**
 * A database failure, said the way every other Localix failure is said.
 *
 * The mini app used to grow a new error shape per surface — a centered card in the results pane, a
 * red strip over the connection list, a tinted line under a tree node. None of them reached the
 * Event Center, so an engine message you were not watching when it arrived was gone.
 *
 * Ownership of a standing report belongs to the SDK now. What is left here is the mini app's own
 * two defaults: its scope, and the shape of a database failure — one engine sentence about one
 * subject. Recovery is declared ONCE and lands in both places it is needed, because a Retry that
 * exists only on a pane the person has closed is not recovery.
 */

import type { MiniAppProblemLineProps } from '@localixai/mini-app-sdk/ui/components'
import { useProblemReport } from '@localixai/mini-app-sdk/ui'
import type {
  Problem,
  ProblemConsequence,
  ProblemRecovery,
} from '@localixai/mini-app-sdk/ui/problems'
import { DbApiError } from './api/databaseApi'

/** Namespace for this mini app's rows in the Event Center. */
export const DB_PROBLEM_SCOPE = 'database'

export interface DbProblemOptions {
  /** Overrides the headline. Omit it: one problem's own message is the honest headline. */
  title?: string
  /** The raw engine text behind `message`. Event Center only — never on the line. */
  detail?: string
  consequence?: ProblemConsequence
  actions?: readonly ProblemRecovery[]
}

/**
 * A failed `/rpc/database` call as a problem.
 *
 * The backend already separates the two halves — a sentence in `error`, the driver's own words in
 * `detail` — and every state that stored only `err.message` threw the second half away. For
 * anything that is NOT a typed API failure (a dropped fetch, a thrown string) the raw text is not a
 * sentence, so `fallback` classifies and the raw text is kept for the record.
 */
export function dbProblem(error: unknown, fallback: string): Problem {
  if (error instanceof DbApiError) {
    // The code and the failed call ride along, so the row names THIS request and its log line.
    return {
      message: error.message,
      detail: error.detail,
      ...(error.code ? { code: error.code } : {}),
      ...(error.request ? { request: error.request } : {}),
    }
  }
  return {
    message: fallback,
    detail: error instanceof Error ? error.message : undefined,
  }
}

/**
 * Publish `problem` about `subject` for as long as it stands, and return exactly what the surface
 * renders: `{problem && <ProblemLine {...problem} />}`. Null when there is nothing wrong.
 *
 * A bare string is the shorthand for `{ message }`. Anything carrying a driver's own words passes
 * the whole {@link Problem} instead — the alternative was a parallel `…Detail` field threaded
 * beside every error through every component between the fetch and the line, and the two drift.
 */
export function useDbProblem(
  subject: string,
  problem: string | Problem | null | undefined,
  options: DbProblemOptions = {},
): MiniAppProblemLineProps | null {
  const { title, detail, consequence = 'blocked', actions } = options
  const stated = typeof problem === 'string' ? { message: problem } : problem
  const owned = useProblemReport(
    stated?.message
      ? {
          subject: { label: subject },
          problems: [{ ...stated, detail: stated.detail ?? detail }],
          consequence,
          title,
        }
      : null,
    { scope: DB_PROBLEM_SCOPE, sourceVisible: true, actions },
  )
  return owned
}
