import type { CcHookEvent, CcHookHandler, CcHookInput, CcHookOutcome } from './contracts'

/**
 * The `<hook name> hook error` notice Claude Code shows in the transcript (hooks.md, "Exit code
 * output"): for a non-blocking error — any other exit code, a timeout, a hook that cannot start,
 * output that is not valid JSON — and, on the events where exit 2 "shows stderr to user only",
 * for that stderr. The hook name is the event, with the tool for a tool event (`PreToolUse:Bash`).
 */
const STDERR_TO_USER: ReadonlySet<CcHookEvent> = new Set([
  'SessionStart',
  'SubagentStart',
  'SessionEnd',
  'CwdChanged',
  'FileChanged',
  'PostCompact',
  'PostModelSwitch',
])

const firstLine = (text: string | undefined) => text?.trim().split('\n')[0]?.trim() || undefined

function handlerName(h: CcHookHandler): string {
  if (h.kind === 'http') return h.httpUrl ?? 'http'
  if (h.kind === 'mcp_tool') return h.mcpTool ?? 'mcp_tool'
  if (h.kind === 'prompt' || h.kind === 'agent') return h.kind
  return h.command
}

export function hookErrorNotice(
  event: CcHookEvent,
  h: CcHookHandler,
  input: CcHookInput,
  outcome: CcHookOutcome,
): string | undefined {
  const toolName = 'tool_name' in input ? input.tool_name : undefined
  const tool = typeof toolName === 'string' ? `:${toolName}` : ''
  const prefix = `${event}${tool} hook error: [${handlerName(h)}]: `
  if (outcome.blocked) {
    if (!STDERR_TO_USER.has(event)) return undefined
    return `${prefix}${firstLine(outcome.blockReason) ?? 'exit 2'}`
  }
  if (!outcome.failed) return undefined
  if (outcome.failed === 'timeout') return `${prefix}timed out after ${h.timeoutMs / 1000}s`
  const detail = firstLine(outcome.failureDetail)
  if (h.kind === 'prompt' || h.kind === 'agent') return `${prefix}${detail ?? 'no verdict'}`
  if (detail?.startsWith('hook output is not valid JSON')) return `${prefix}${detail}`
  return `${prefix}Failed with non-blocking status code${detail ? `: ${detail}` : ''}`
}
