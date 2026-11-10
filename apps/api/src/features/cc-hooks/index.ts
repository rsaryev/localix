/**
 * Claude Code hooks, Localix side: where a run applies a hook's decision to its tools (the hook
 * engine is the kit session's, `features/plugins/kit/hooks`). The few Claude Code events with no
 * Localix equivalent are listed with their reason in `CC_INERT_HOOK_EVENTS`. See
 * `docs/extending/claude-code-plugins.md`.
 */
export * from './contracts'
export type { CcHooksRuntime, CcHookToolRef, WorktreeCreateResult } from './runtime-contracts'
export { ccSessionEnvFiles, ccSessionEnvScripts, type CcSessionEnvFiles } from './session-env'
export type { CcTranscript } from './transcript'
export { EMPTY_RUNTIME as INERT_CC_HOOKS } from './runtime-results'
export type * from './runtime-contracts-added'
export { approvedInputFor, wrapToolsWithCcHooks } from './wrap-tools'
