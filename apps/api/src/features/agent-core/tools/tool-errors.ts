// Shared builder for the file-mutation tools' error envelope. edit / write /
// apply_patch all return the same `{ content, isError, error: { kind, message,
// userMessage, retryable, fatal } }` shape; this centralizes that literal so the
// envelope stays consistent. Each tool keeps its own thin wrapper for its
// default kind/retryable policy — only the object construction is shared.
export type ToolErrorKind = 'validation' | 'not_found'

export interface ToolErrorOptions {
  /** Model-facing result text. Defaults to `message`. */
  content?: string
  /** Internal/error message. */
  message: string
  /** Human-facing message. Defaults to `message`. */
  userMessage?: string
  kind?: ToolErrorKind
  retryable?: boolean
}

export function buildToolError(opts: ToolErrorOptions) {
  const {
    message,
    content = message,
    userMessage = message,
    kind = 'validation',
    retryable = false,
  } = opts
  return {
    content,
    isError: true as const,
    error: { kind, message, userMessage, retryable, fatal: false as const },
  }
}
