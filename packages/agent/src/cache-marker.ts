/**
 * The system-prompt cache-boundary marker. Everything from this header onward in the
 * assembled system prompt is the volatile, per-turn runtime-context tail that is split
 * OUT of the cached prefix — so a change in the tail never re-caches the stable prefix.
 *
 * SINGLE SOURCE OF TRUTH. The thing that EMITS this header (the prompt assembler in
 * agent-core/system-prompt-sections.ts) and the things that SPLIT on it must agree on
 * the exact string, or the cached prefix silently breaks. Imported by:
 *   - agent-core/system-prompt-sections.ts        (emits the header)
 *   - chat/runtime/run/system-prompt-build.ts     (run-path prefix/tail split)
 *   - chat/runtime/message-persistence.ts          (cache-diagnostics partition)
 */
export const RUNTIME_CONTEXT_MARKER = '# Runtime context'
