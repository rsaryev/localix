import type { ChatRepository } from '../repository'
import type { RunnerDeps } from './agent-runner-types'
import type { RuntimeState } from './agent-runner-state'
import { isInteractAllowedForOwner } from './interact-ownership'
import { listSessionGrants, revokeSessionGrant } from './session-grants'

export interface RunnerInteractionDeps {
  deps: Pick<RunnerDeps, 'streamRegistry'>
  repo: ChatRepository
  state: RuntimeState
}

/**
 * The runner's answers to a person acting on something live: a running tool's action button,
 * or a session's "Always allow" grants.
 *
 * A standalone yes/no used to live here too, for a plugin to ask outside any run. Nothing ever
 * called it, and its card rendered the title twice (once as the heading, once as the "command").
 * Every confirmation now comes from the permission gate, which knows what it is asking about.
 *
 * Every externally reachable one is ownership-gated, and each gate reads the owner from the
 * thing acted on — the action entry, the session row — because the runner keys its state by id
 * alone, and a foreign caller who knows an id must not be able to kill another user's job or
 * unlock another user's tools.
 */
export function createRunnerInteraction({ deps, repo, state }: RunnerInteractionDeps) {
  /**
   * Does `userId` own this session? FAIL-CLOSED: a repo error answers "no", never "yes".
   * Same primitive the service's `requireSession` gate uses, reduced to a boolean.
   */
  const ownsSession = (userId: string, sessionId: string): Promise<boolean> =>
    repo
      .getSession(userId, sessionId)
      .then((s) => s !== null)
      .catch(() => false)

  return {
    /** The session's current "Always allow" tool set (sorted). Read-only. */
    listSessionAutoApprovedTools(sessionId: string): string[] {
      return listSessionGrants(state.sessionAutoApprovedTools, sessionId)
    },

    /**
     * Revoke a session's "Always allow" grant (one tool, or all when `toolName` is
     * omitted) so the tool re-prompts on its next call. Ownership-gated (see
     * `ownsSession`) so a foreign user can't unlock/lock another session's grants.
     * Publishes `session_permissions.updated` so every client's chip refreshes.
     * Returns the remaining set, or null when the caller doesn't own the session.
     */
    async revokeSessionAutoApproval(
      userId: string,
      sessionId: string,
      toolName?: string,
    ): Promise<string[] | null> {
      if (!(await ownsSession(userId, sessionId))) return null
      const remaining = revokeSessionGrant(state.sessionAutoApprovedTools, sessionId, toolName)
      deps.streamRegistry.publish(userId, sessionId, {
        type: 'session_permissions.updated',
        sessionId,
        autoApprovedTools: remaining,
      })
      return remaining
    },

    /**
     * Execute a named action registered by a running tool (e.g. "kill").
     * Returns false if the toolCallId or action name is not found.
     */
    executeToolAction(
      toolCallId: string,
      actionName: string,
      payload?: unknown,
      callerUserId?: string,
    ): boolean {
      // A foreign caller must not reach another user's running tool (HTTP/WS interact). The
      // owner is read from the ENTRY being acted on, which records it for every registrant —
      // an owner looked up anywhere narrower answers "no owner" (= allow) for the rest. Trusted
      // internal callers pass no callerUserId, and in single-user owner == caller.
      const entry = state.actionRegistry.get(toolCallId)
      if (!isInteractAllowedForOwner(entry?.userId, callerUserId)) {
        return false
      }
      const action = entry?.actions[actionName]
      if (!action) return false
      action.execute(payload)
      return true
    },
  }
}
