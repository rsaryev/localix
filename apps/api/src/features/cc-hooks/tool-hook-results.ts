/**
 * What the tool hooks add to, or make of, a tool result (`wrap-tools.ts`).
 */
import type { AgentToolResult } from '@localixai/agent/agents'

import { isRecord } from '../../lib/record'

/**
 * A tool hook's `additionalContext` beside the tool result: Claude Code "wraps the string in a
 * system reminder and inserts it into the conversation at the point where the hook fired" — for
 * the tool events, "next to the tool result". The kit already capped each hook's string at 10,000
 * characters (a longer one is saved to a file), so the joined notes are not cut again, and the
 * note arrives with its reminder tags escaped (`plugins/kit/hooks/runtime.ts`, `claudeText`).
 */
export function withContextReminder(content: string, note: string | undefined): string {
  if (!note?.trim()) return content
  return `${content}\n\n<system-reminder>\n${note}\n</system-reminder>`
}

/**
 * PostToolUseFailure's `error` for a call that ran and failed: for a shell command "a command
 * that ran and exited produces a first line `Exit code N`" followed by its output; otherwise the
 * tool's own error message.
 */
export function failureText(result: AgentToolResult): string {
  const details = result.details
  if (isRecord(details) && typeof details.exitCode === 'number') {
    const output = typeof details.output === 'string' ? details.output : result.content
    return output ? `Exit code ${details.exitCode}\n${output}` : `Exit code ${details.exitCode}`
  }
  return result.error?.message || result.content
}
