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
} from '../../../capabilities/permission-modes'
import { applyPermissionMode } from '../../../capabilities/permission-mode-policy'
import { defineAxis } from '../axis'

export interface PermissionFacts {
  permissionMode?: PermissionMode
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
    applies: (facts) => (facts.permissionMode ?? DEFAULT_PERMISSION_MODE) === mode,
    decide: () => ({
      mode,
      planning: mode === 'plan',
      humanExpected: applyPermissionMode(mode, []).humanReachable,
    }),
  })),
)
