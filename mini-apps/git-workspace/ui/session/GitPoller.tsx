import type { SessionSurfaceProps } from '@localixai/mini-app-sdk/ui'
import { useMiniAppSessions } from '@localixai/mini-app-sdk/ui/runtime-hooks'
import { useGitPoller } from '../source-control/model/useGitPoller'

/**
 * The source-control poller for ONE chat — the session it is mounted for, never "the active one".
 *
 * It was an app-level mount that read the active session, and the SDK no longer offers that: an
 * app-level component belongs to no chat, so whichever chat it guessed was the one the person
 * happened to be in front of, not the one a branch pill or a Git tab was showing. Every place that
 * mounts it now names its chat: the `chat.background` surface (the host passes the session while
 * that chat is focused, null otherwise) and the Git workspace tab (its own chat, while visible).
 */
export function GitPoller({ sessionId }: Pick<SessionSurfaceProps, 'sessionId'>) {
  const sessions = useMiniAppSessions()
  const session = sessionId ? sessions.find((candidate) => candidate.id === sessionId) : undefined
  useGitPoller(sessionId, session?.isRunning, session?.projectId)
  return null
}
