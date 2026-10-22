/**
 * Claude Code's `sessionTitle` (SessionStart and UserPromptSubmit hook output): "Sets the session
 * title, with the same effect as /rename". Written as the person's rename is — the session row,
 * then a `session.updated` so every open client re-reads it. A later generated title does not
 * replace it: that write only lands while the fallback title is still current.
 */
import { toSessionSummary } from '../repository'
import type { RunnerDeps } from './agent-runner-types'

/** The longest title a hook may set; the rest of a runaway value is dropped. */
const MAX_TITLE_CHARS = 200

export async function applyHookSessionTitle(
  deps: Pick<RunnerDeps, 'repo' | 'streamRegistry'>,
  userId: string,
  sessionId: string,
  title: string | undefined,
): Promise<void> {
  const name = title?.trim().slice(0, MAX_TITLE_CHARS)
  if (!name) return
  await deps.repo.updateSession(userId, sessionId, { title: name })
  const updated = await deps.repo.getSession(userId, sessionId)
  if (updated)
    deps.streamRegistry.publish(userId, sessionId, {
      type: 'session.updated',
      session: toSessionSummary(updated),
    })
}
