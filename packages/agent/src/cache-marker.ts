/**
 * The system-prompt cache-boundary marker. Everything from this header onward in the
 * assembled system prompt is the volatile, per-turn runtime-context tail that is split
 * OUT of the cached prefix — so a change in the tail never re-caches the stable prefix.
 *
 * SINGLE SOURCE OF TRUTH. The thing that EMITS this header (the runtime-context section in
 * agent-core/prompt/sections/workspace.ts) and the things that SPLIT on it must agree on the
 * exact string, or the cached prefix silently breaks. Its readers are the emitter and the opt-in
 * cache diagnostics (`chat/runtime/cache-diagnostics.ts`); the run path splits structurally.
 */
export const RUNTIME_CONTEXT_MARKER = '# Runtime context'
