// Re-export the memory-provider hooks so existing host importers keep one entry point.
export { loadMemoryProviderContext, runMemoryProviderRunEnd } from './memory-hooks'

/**
 * Plugin hook execution — the runtime side of the `PluginHooks` contract in
 * [[native]]. The loader collects `{ pluginName, hooks, ctx }` entries from enabled
 * plugins ([[loader]] `LoadedPlugins.hooks`); agent-runner threads them here.
 *
 * The implementations live in three focused cluster modules (re-exported below):
 *
 * - [[hooks-tools]] `wrapToolsWithHooks` wraps EVERY tool's `execute` (built-in,
 *   plugin, MCP alike) so `onPreToolCall` can audit/block/rewrite and
 *   `onPostToolCall` can annotate.
 * - [[hooks-messages]] `runUserMessageHooks` / `runAssistantMessageHooks` rewrite
 *   the model-facing prompt and the persisted assistant reply.
 * - [[hooks-lifecycle]] the observer-only notifications (`onSubagentStop`,
 *   `onHitlRequest`/`onHitlResolved`, `onHumanAssigned`) plus `runSessionEndHooks`.
 *
 * Guarantees (same for every hook): per-plugin try/catch isolation — a throwing
 * hook is logged and NEVER breaks the turn — and a hard timeout per invocation
 * (HOOK_TIMEOUT_MS, timeout ⇒ treated as a void return).
 */

export { POST_APPEND_CAP_BYTES, ToolCallBlockedError, wrapToolsWithHooks } from './hooks-tools'
export { runUserMessageHooks, runAssistantMessageHooks } from './hooks-messages'
export {
  runSubagentStopHooks,
  runHitlRequestHooks,
  runHitlResolvedHooks,
  runHumanAssignedHooks,
  runSessionEndHooks,
} from './hooks-lifecycle'
