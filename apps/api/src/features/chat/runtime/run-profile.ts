import { resolveRunProfile, type AgentSessionKind } from '../../agent-core/run-shape'
import type { RunIdentity } from './run-contract'

/** Native host rosters cannot be bypassed by a remembered compatibility profile. */
export function resolveExecutionProfile(
  session: { sessionKind: AgentSessionKind },
  instructions: string | null | undefined,
  identity: Pick<RunIdentity, 'hostTools' | 'profileOverride'>,
) {
  if (identity.hostTools === undefined && identity.profileOverride) return identity.profileOverride
  return resolveRunProfile(session, {
    ...(instructions ? { prompt: instructions } : {}),
    ...(identity.hostTools !== undefined ? { tools: identity.hostTools } : {}),
  })
}
