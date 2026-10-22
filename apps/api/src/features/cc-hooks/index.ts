/**
 * Claude Code declarative hooks — public surface.
 *
 * Enabled-plugin `hooks/hooks.json` files run at the dispatched lifecycle points
 * (`CC_HOOK_EVENTS`; the few Claude Code events with no Localix equivalent are listed with
 * their reason in `CC_INERT_HOOK_EVENTS`), complementing the in-process native plugin hooks. All five CC handler types are supported —
 * `command`, `http`, `mcp_tool`, `prompt`, and `agent` — each on the events the CC
 * matrix allows. See `docs/extending/plugins.md`.
 */
export * from './contracts'
export {
  buildCcHookRegistry,
  parseScopedHooks,
  mergeCcHookRegistries,
  type PluginHookConfig,
  type ScopedHookPlugin,
} from './config'
export { createCcHooksRuntime, type CcHooksRuntime } from './run'
export { EMPTY_RUNTIME as INERT_CC_HOOKS } from './runtime-results'
export type * from './runtime-contracts-added'
export type { WorktreeCreateResult } from './runtime-worktree-hooks'
export type { CcToolBatchCall } from './protocol-event-inputs'
export { approvedInputFor, wrapToolsWithCcHooks } from './wrap-tools'
export { parsePromptHookResult, type PromptHookResult } from './prompt-hook'

export { type CcMcpToolResult } from './mcp-tool-hook'
