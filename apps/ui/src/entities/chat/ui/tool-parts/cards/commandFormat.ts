// Pure formatting for the command (bash) tool card title, extracted from
// CommandCard so the comment-extraction + truncation rules are testable.

const MAX_COMMAND_DISPLAY_LINES = 2
const MAX_COMMAND_DISPLAY_CHARS = 160

/** Extract a `# label` comment from the first non-empty line of a command. */
export function extractCommentLabel(command: string): string | null {
  for (const line of command.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) return trimmed.slice(1).trim() || null
    if (trimmed) break
  }
  return null
}

/**
 * Format a raw command for display: prefer its `# label` comment, otherwise
 * truncate to MAX_COMMAND_DISPLAY_LINES / MAX_COMMAND_DISPLAY_CHARS with a
 * trailing "…".
 */
export function formatCommand(command: string): string {
  const label = extractCommentLabel(command)
  if (label)
    return label.length > MAX_COMMAND_DISPLAY_CHARS
      ? label.slice(0, MAX_COMMAND_DISPLAY_CHARS) + '…'
      : label

  const lines = command.split('\n')
  let truncated =
    lines.length > MAX_COMMAND_DISPLAY_LINES
      ? lines.slice(0, MAX_COMMAND_DISPLAY_LINES).join('\n')
      : command
  if (truncated.length > MAX_COMMAND_DISPLAY_CHARS)
    truncated = truncated.slice(0, MAX_COMMAND_DISPLAY_CHARS)
  const needsEllipsis =
    lines.length > MAX_COMMAND_DISPLAY_LINES || command.length > MAX_COMMAND_DISPLAY_CHARS
  return needsEllipsis ? truncated.trim() + '…' : truncated
}
