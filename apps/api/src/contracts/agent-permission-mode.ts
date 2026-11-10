/**
 * THE PERMISSION MODE A DELEGATED CHILD'S AGENT FILE ASKS FOR, among the modes Localix has: Default
 * and Plan. The kit reads the file's `permissionMode` and decides when it applies
 * (`features/plugins/kit/spawn.ts`). A leaf, like `permission-modes.ts`.
 */
import type { PermissionMode } from './permission-modes'

/** The modes an agent file may ask for here. */
export type AgentPermissionMode = Extract<PermissionMode, 'default' | 'plan'>

export const isAgentPermissionMode = (value: unknown): value is AgentPermissionMode =>
  value === 'default' || value === 'plan'
