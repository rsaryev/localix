/**
 * Turn a {@link Prerequisite} into the problem a surface shows and the ONE action that resolves it.
 *
 * Every mini app with an external dependency needs the same three things — "Docker is not running",
 * "Start it with `open -a Docker`", and a button that does that — and before this each one would
 * have written its own, with its own wording and its own idea of what the button may do. The rule
 * lives here once:
 *
 *   missing     → Install <name>   opens the vendor's install page.
 *   stopped     → Start <name>     PASTES the start command into this chat's terminal.
 *   signed-out  → Sign in          PASTES the sign-in command.
 *
 * Pasted, never run: the person reads the line and presses Enter. A mini app offers a command; it
 * does not launch software on their behalf. With no chat to paste into (an app-level tab) the
 * command is copied instead, and the hint names it, so the way out never silently disappears.
 */

import { useMemo } from 'react'

import {
  prerequisiteActionLabel,
  prerequisiteHint,
  prerequisiteTitle,
  type Prerequisite,
} from '../prerequisite'
import type { Problem, ProblemRecovery, ProblemRequest } from './problems'
import { miniAppExternal, miniAppTerminal } from './runtime'
import { useWorkItemSessionId } from './work-item-session'

/** The problem a missing/stopped prerequisite IS — headline, what to do, and the engine's words. */
export function prerequisiteProblem(
  prerequisite: Prerequisite,
  extra: { code?: string; detail?: string; request?: ProblemRequest } = {},
): Problem {
  return {
    severity: 'error',
    message: prerequisiteTitle(prerequisite),
    hint: prerequisiteHint(prerequisite),
    ...extra,
  }
}

/** The resolving action, or null when the prerequisite carries nothing to act with. */
export function prerequisiteRecovery(
  prerequisite: Prerequisite,
  sessionId: string | null,
): ProblemRecovery | null {
  const label = prerequisiteActionLabel(prerequisite)
  if (!label) return null
  const id = `prerequisite:${prerequisite.id}:${prerequisite.state}`
  if (prerequisite.state === 'missing') {
    const url = prerequisite.installUrl!
    return { id, label, primary: true, run: () => miniAppExternal.open(url) }
  }
  const command = prerequisite.command!
  if (sessionId) {
    return {
      id,
      label,
      primary: true,
      run: () => miniAppTerminal.paste({ sessionId, command }),
    }
  }
  return {
    id,
    label: prerequisite.state === 'stopped' ? 'Copy start command' : 'Copy sign-in command',
    primary: true,
    run: () => navigator.clipboard?.writeText(command),
  }
}

/** {@link prerequisiteRecovery} bound to the chat this surface belongs to. */
export function usePrerequisiteRecovery(
  prerequisite: Prerequisite | null | undefined,
): ProblemRecovery | null {
  const sessionId = useWorkItemSessionId()
  const key = prerequisite ? JSON.stringify(prerequisite) : ''
  return useMemo(
    () => (prerequisite ? prerequisiteRecovery(prerequisite, sessionId) : null),
    // `prerequisite` is rebuilt per render by most callers; its content is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, sessionId],
  )
}
