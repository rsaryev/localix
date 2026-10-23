import { useMemo } from 'react'
import { useProblemReport, type OwnedProblemReport } from '@localixai/mini-app-sdk/ui'
import {
  prerequisiteProblem,
  usePrerequisiteRecovery,
} from '@localixai/mini-app-sdk/ui/prerequisite-recovery'
import type { ProblemReport } from '@localixai/mini-app-sdk/ui/problems'

import type { SourceControlStatus } from '../../../backend/source-control/contracts'
import { gitReadProblem } from './gitFailure'
import { useSourceControlStore } from './store'

/** Namespace for this mini app's rows in the Event Center. */
const SCOPE = 'source-control'

/**
 * The Source Control panel's two standing problems, owned where the panel's state lives.
 *
 * - `missing`: git itself is not on this machine. The panel said "Not a git repository" for that —
 *   false about the directory, and with no way out. Now it is the pane, with Install Git.
 * - `read`: a status read failed. It was a red text strip that never reached the Event Center, so a
 *   failure seen for a second was gone for good; it is the host's problem line now.
 *
 * A hook, called before the panel's early returns: an owner that only exists inside the failing
 * branch is unmounted exactly when the failure ends, and its row is never settled.
 */
export function useGitProblems({
  sessionId,
  status,
  error,
}: {
  sessionId: string | null
  status: SourceControlStatus | null | undefined
  error: string | null | undefined
}): { missing: OwnedProblemReport | null; read: OwnedProblemReport | null } {
  // Re-read the status: after installing git, "Check again" is how the panel finds out.
  const onRetry = () => {
    if (sessionId) void useSourceControlStore.getState().refresh(sessionId)
  }
  const prerequisite = status?.prerequisite
  const recovery = usePrerequisiteRecovery(prerequisite)

  const missingReport = useMemo<ProblemReport | null>(
    () =>
      prerequisite
        ? {
            subject: { label: 'Git' },
            problems: [prerequisiteProblem(prerequisite, { code: 'git_missing' })],
            consequence: 'blocked',
          }
        : null,
    [prerequisite],
  )
  const missing = useProblemReport(missingReport, {
    scope: SCOPE,
    sourceVisible: true,
    actions: [...(recovery ? [recovery] : []), { id: 'retry', label: 'Check again', run: onRetry }],
  })

  const readReport = useMemo<ProblemReport | null>(() => {
    if (!error || prerequisite) return null
    // Our sentence and the one fix; git's raw stderr is the Event Center detail.
    const { message, hint } = gitReadProblem(error)
    return {
      subject: { label: 'Repository status' },
      problems: [{ severity: 'error', message, hint, detail: error }],
      consequence: 'stale',
    }
  }, [error, prerequisite])
  const read = useProblemReport(readReport, {
    scope: SCOPE,
    sourceVisible: true,
    actions: [{ id: 'retry', label: 'Retry', run: onRetry }],
  })

  return { missing, read }
}
