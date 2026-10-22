/**
 * What the tool hooks add to, or make of, a tool result (`wrap-tools.ts`).
 */
import type { AgentToolResult } from '@localixai/agent/agents'

import { isRecord } from '../../lib/record'
import { CC_POST_APPEND_CAP_BYTES } from './contracts'

/** An exact reminder tag inside the hook's text; Claude Code escapes its `<` (hooks.md). */
const REMINDER_TAG = /<(\/?system-reminder>)/g

/**
 * A tool hook's `additionalContext` beside the tool result: Claude Code "wraps the string in a
 * system reminder and inserts it into the conversation at the point where the hook fired" — for
 * the tool events, "next to the tool result". Capped at {@link CC_POST_APPEND_CAP_BYTES}.
 */
export function withContextReminder(content: string, note: string | undefined): string {
  if (!note?.trim()) return content
  const body = note.slice(0, CC_POST_APPEND_CAP_BYTES).replace(REMINDER_TAG, '&lt;$1')
  return `${content}\n\n<system-reminder>\n${body}\n</system-reminder>`
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
