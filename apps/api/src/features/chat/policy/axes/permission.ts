/**
 * PERMISSION — the session's permission mode, the person's standing answer to "may it act
 * without asking me?".
 *
 * How a mode rewrites the agent's rules stays beside the rules (`capabilities/
 * permission-mode-policy.ts`, one strategy per mode). This axis carries the mode itself and the
 * two facts the rest of the run reads from it: whether the run is planning, and whether the
 * person is expected to answer at all.
 */
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  type PermissionMode,
} from '../../../../contracts/permission-modes'
import { childPermissionMode } from '../../../../contracts/agent-permission-mode'
import type { SessionProvenance } from '../../session-provenance'
import { applyPermissionMode } from '../../../capabilities/permission-mode-policy'
import { defineAxis } from '../axis'

export interface PermissionFacts {
  permissionMode?: PermissionMode
  /** A delegated child may carry the mode its agent's file asked for. */
  provenance?: Pick<SessionProvenance, 'kind'> & { agentPermissionMode?: 'default' | 'plan' }
}

/**
 * The mode the run is in: the row's, which a root's mode change writes to its whole tree, with a
 * delegated child's agent letting it plan under a Default conversation
 * (`contracts/agent-permission-mode.ts`). Read from the provenance, so a change of the tree's mode
 * never erases what the agent asked for.
 */
const modeOf = (facts: PermissionFacts): PermissionMode => {
  const conversation = facts.permissionMode ?? DEFAULT_PERMISSION_MODE
  return facts.provenance?.kind === 'task-delegation'
    ? childPermissionMode(conversation, facts.provenance.agentPermissionMode)
    : conversation
}

export interface PermissionDecision {
  mode: PermissionMode
  /** The run drafts a plan instead of implementing (`# Plan mode`). */
  planning: boolean
  /** The mode expects the person to answer cards; `autonomous` does not. */
  humanExpected: boolean
}

export const permissionAxis = defineAxis<PermissionFacts, PermissionDecision>(
  'permission',
  PERMISSION_MODES.map((mode) => ({
    id: mode,
    applies: (facts) => modeOf(facts) === mode,
    decide: () => ({
      mode,
      planning: mode === 'plan',
      humanExpected: applyPermissionMode(mode, []).humanReachable,
    }),
  })),
)
