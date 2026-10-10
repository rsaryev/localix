/**
 * Claude Code declarative hooks — public surface.
 *
 * Enabled-plugin `hooks/hooks.json` files run at the dispatched lifecycle points
 * (SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop / SessionEnd /
 * SubagentStart / SubagentStop / PreCompact), complementing the in-process native
 * plugin hooks. All five CC handler types are supported —
 * `command`, `http`, `mcp_tool`, `prompt`, and `agent` — each on the events the CC
 * matrix allows. See `docs/extending/plugins.md`.
 */
export * from './contracts'
export {
  buildCcHookRegistry,
  parseScopedHooks,
  mergeCcHookRegistries,
  type PluginHookConfig,
} from './config'
export { createCcHooksRuntime, type CcHooksRuntime } from './run'
export { wrapToolsWithCcHooks } from './wrap-tools'
export { parsePromptHookResult, type PromptHookResult } from './prompt-hook'

export { type CcMcpToolResult } from './mcp-tool-hook'
