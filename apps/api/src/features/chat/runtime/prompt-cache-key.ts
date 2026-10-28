import { createHash } from 'node:crypto'

/** What a session's requests have in common with another session's: the start of the prefix. */
export interface PromptCacheIdentity {
  userId: string
  providerConnectionId: string
  modelId: string
  /** The agent that speaks: its prompt and its tools are the start of the request. */
  agentId: string
  /** The folder the session works in: what "project" means here. */
  workspaceRoot: string | undefined
}

/**
 * The key OpenAI's prompt cache routes a session's requests by (`prompt_cache_key`).
 *
 * OpenAI routes a request by a hash of its first tokens (the tools, then the system prompt) and
 * the key: a key of its own per session sends every session's identical system prompt to another
 * machine, so a new session writes a cache that an earlier one already holds. Sessions of one
 * agent, model and working folder send that prefix identically (`cross-session-prefix.test.ts`), so they
 * share a key and read each other's.
 *
 * The key names who the request is for, never what the prefix says: the prompt hash and the tool
 * schema hash change within a session (a plan, a skill pinned, a tool activated), and a key that
 * moved with them would send the whole history to a machine that does not hold it.
 */
export function sharedPromptCacheKey(identity: PromptCacheIdentity): string {
  const hash = createHash('sha256')
    .update(
      JSON.stringify([
        identity.userId,
        identity.providerConnectionId,
        identity.modelId,
        identity.agentId,
        identity.workspaceRoot ?? null,
      ]),
    )
    .digest('hex')
  // `lx-` then 32 hex characters: well under the 64 OpenAI keeps.
  return `lx-${hash.slice(0, 32)}`
}
