/**
 * THE PERMISSION MODE OF A DELEGATED CHILD whose agent file has a `permissionMode`
 * (sub-agents.md): the conversation's mode wins, except that a conversation in Default lets the
 * agent's own mode apply. A conversation in bypass or autonomous (Claude Code's
 * `bypassPermissions` and `auto` parents) or in Plan keeps its mode in the child.
 *
 * Localix has only Default and Plan among the modes an agent file can name. `acceptEdits`, `auto`,
 * `dontAsk` and `bypassPermissions` have no mode here that behaves as they do (the last is also
 * the one Claude Code refuses a child outright), so an agent naming them runs in its conversation's
 * mode, as Claude Code does for a mode that is unavailable. A leaf, like `permission-modes.ts`.
 */
import type { PermissionMode } from './permission-modes'

/** The modes an agent file may ask for here. */
export type AgentPermissionMode = Extract<PermissionMode, 'default' | 'plan'>

/** The Localix mode an agent file's `permissionMode` asks for; none when nothing here matches. */
export function agentPermissionModeOf(written: unknown): AgentPermissionMode | undefined {
  if (written === 'default' || written === 'manual') return 'default'
  return written === 'plan' ? 'plan' : undefined
}

/** The mode a child runs in, given its conversation's mode and the one its agent asked for. */
export function childPermissionMode(
  conversation: PermissionMode,
  asked: AgentPermissionMode | undefined,
): PermissionMode {
  return conversation === 'default' && asked ? asked : conversation
}
