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
  parseHooksBlock,
  parseScopedHooks,
  mergeCcHookRegistries,
  type PluginHookConfig,
  type SkippedHandler,
} from './config'
export { createCcHooksRuntime, type CcHooksRuntime } from './run'
export { wrapToolsWithCcHooks, CcHookBlockedError } from './wrap-tools'
export {
  parsePromptHookResult,
  mapPromptOutcome,
  type PromptHookResult,
  type PromptHookEvaluator,
} from './prompt-hook'
export { type AgentHookEvaluator } from './agent-hook'
export { interpolateEnv, executeHttpHook } from './http'
export { runMcpToolHook, type CcMcpToolCaller, type CcMcpToolResult } from './mcp-tool-hook'
export { foldHookOutput } from './output-parse'
