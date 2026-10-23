/**
 * Refuse a policy change this registry cannot accept, before anything is written.
 *
 * One rule: the agent the app itself runs on cannot be denied, in any scope. A guard rather than
 * a silent clamp, because a scope that quietly kept an agent the user told it to drop would be
 * lying in the very screen that reports what is in force.
 *
 * It applies {@link agentPolicy} and it THROWS — and the throw is why it is not in `policy.ts`.
 * That module is a shared leaf (`@localixai/api/agent-policy`): the settings screen imports it to
 * grey out what a user may not edit, so every value it imports ships to the browser. `ApiError`
 * comes from the mini app SDK's BACKEND barrel, which reaches `node:dns`, `node:net` and
 * `node:fs/promises`; with this function inside the leaf, opening the agent profile tab threw
 * "Module node:dns has been externalized" at render. The rule stays where the settings screen
 * can read it; the refusal lives here, on the server, beside the service that writes.
 */
import { InvalidRequestError } from '../../lib/domain-errors'
import type { AgentSummary } from './contracts'
import { agentPolicy } from './policy'

export function assertDisablable(
  catalog: readonly Pick<AgentSummary, 'record' | 'builtin' | 'registration'>[],
  deniedAgentIds: readonly string[],
): void {
  for (const id of deniedAgentIds) {
    const entry = catalog.find((candidate) => candidate.record.id === id)
    // A rule may name an agent this scope has never heard of — another machine's registry, or
    // one since deleted. There is nothing here to protect.
    if (entry && !agentPolicy(entry).disable) {
      throw new InvalidRequestError(
        'agent_always_enabled',
        'This agent cannot be switched off — the app runs on it. Duplicate it to get one you own.',
      )
    }
  }
}
