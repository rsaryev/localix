import {
  resolveRunProfile,
  shapeDefaultTools,
  type AgentSessionKind,
} from '../../agent-core/run-shape'
import { TOOL } from '../../agent-core/tool-names'
import type { RunIdentity } from './run-contract'

/** Native host rosters cannot be bypassed by a remembered compatibility profile. */
export function resolveExecutionProfile(
  session: { sessionKind: AgentSessionKind; agents?: readonly unknown[] },
  instructions: string | null | undefined,
  identity: Pick<RunIdentity, 'hostTools' | 'profileOverride'>,
) {
  if (identity.hostTools === undefined && identity.profileOverride) return identity.profileOverride
  const teamTools =
    session.sessionKind === 'subagent' && (session.agents?.length ?? 0) > 1
      ? [
          ...new Set([
            ...(identity.hostTools ?? shapeDefaultTools('subagent')),
            TOOL.conversation_control,
          ]),
        ]
      : identity.hostTools
  return resolveRunProfile(session, {
    ...(instructions ? { prompt: instructions } : {}),
    ...(teamTools !== undefined ? { tools: teamTools } : {}),
  })
}
