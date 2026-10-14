/**
 * Shared console-backed warn loggers for chat-runtime subsystem wiring.
 *
 * The plugin lifecycle-hook runners (onUserMessage / onAssistantMessage /
 * onSessionEnd / pre+post tool-call) all take a `{ warn(message) }` logger;
 * every chat-runtime call site wants the same console.warn sink, so it lives
 * here once instead of being re-literalled per call.
 */
export const consoleWarnLogger: { warn: (message: string) => void } = {
  warn: (message: string) => console.warn(message),
}

/**
 * Console-backed `{ warn(msg, meta?) }` logger that prefixes every message with
 * `[prefix]`. Used by the plugin and MCP loaders, which both take
 * the same logger shape and differ only by their bracket tag.
 */
export function prefixedWarnLogger(prefix: string): {
  warn: (msg: string, meta?: unknown) => void
} {
  return {
    warn: (msg: string, meta?: unknown) => console.warn(`[${prefix}] ${msg}`, meta ?? ''),
  }
}
