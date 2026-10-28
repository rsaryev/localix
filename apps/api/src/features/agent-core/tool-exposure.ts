import type { ToolExposure } from '@localixai/agent/agents'

/**
 * The shape of a built-in tool's catalog entry and the exposure presets the catalog
 * (`tool-names.ts`) spells its entries with; a leaf, so the catalog reads it, never the reverse.
 */

export type BuiltinToolCategory = 'core' | 'filesystem' | 'knowledge' | 'automation' | 'ui'

export interface BuiltinToolDefinition {
  /** The tool's one name, Claude Code's spelling (`Read`, `Bash`): the model, a rule and the UI use it. */
  name: string
  /**
   * Offered through `ToolSearch` instead of on the wire, as Claude Code defers the tools it seldom
   * needs: the model loads the schema the turn it needs one, and a call by name reaches it anyway.
   * Only an open toolset defers; a list that names the tool keeps it on the wire.
   */
  deferred?: true
  label: string
  description: string
  category: BuiltinToolCategory
  /** Which run shapes may carry the tool — the ledger's first gate and the source of each
   *  shape's default surface (`run-shape.ts`). There is no other list of "what a child gets". */
  exposure: ToolExposure
}

// The exposure vocabulary, spelled once. `never` is the structural bound: a child is never
// TOLD about such a tool either, so it cannot spend a turn discovering it cannot have it.
export const EVERYWHERE: ToolExposure = {
  chat: 'default',
  subagent: 'default',
  automation: 'default',
}
export const CHAT_AND_CHILD: ToolExposure = {
  chat: 'default',
  subagent: 'default',
  automation: 'opt-in',
}
export const CHAT_DEFAULT: ToolExposure = {
  chat: 'default',
  subagent: 'opt-in',
  automation: 'opt-in',
}
export const CHAT_ONLY: ToolExposure = { chat: 'default', subagent: 'never', automation: 'never' }
