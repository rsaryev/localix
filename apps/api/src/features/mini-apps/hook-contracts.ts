/**
 * Lifecycle-hook + memory-provider contracts — OWNED by `@localixai/mini-app-sdk`
 * (the plugin-facing contract package); re-exported here so the historical import
 * surface (native.ts, hooks.ts, loader.ts, prompt-context.ts, finalize.ts, plugin
 * tests) stays unchanged. The host implements these; plugins compile against the
 * SDK directly.
 */
export {
  ASSISTANT_BINDINGS_MAX,
  ASSISTANT_BINDING_DATA_CAP_BYTES,
  MEMORY_CONTEXT_CAP_CHARS,
  MEMORY_TIMEOUT_MS,
} from '@localixai/mini-app-sdk/backend'
export type {
  AssistantMessageEvent,
  HitlRequestEvent,
  HitlResolvedEvent,
  HumanAssignedEvent,
  MemoryLoadContextEvent,
  MemoryProvider,
  MemoryRunEndEvent,
  MiniAppHooks,
  SubagentStopEvent,
} from '@localixai/mini-app-sdk/backend'
