import type { AgentToolResult } from '@localixai/agent/agents'
import type { ToolErrorKind } from '@localixai/agent'

/**
 * A THROWN tool error, in the shape the rest of the wrapper chain reads.
 *
 * Its home used to be the failure guard, which is where a throw is COUNTED. But the
 * two hook wrappers sit INSIDE that guard, and a throw skipping past them took their
 * post hooks with it: a plugin's `onPostToolCall` that redacts or annotates a result
 * never saw a failure, and a user's CC `PostToolUse` hook could not observe one at
 * all. Each of them therefore converts the throw itself, runs its post hooks against
 * the converted result, and returns it — so the function has to be shared, and it
 * lives here rather than in any one of its three callers.
 *
 * Kind is taken from the error's NAME rather than an `instanceof`: the two blocking
 * errors are thrown by the hook wrappers (plugins/, cc-hooks/), and agent-core must
 * not import a feature module to recognise them. `message` keeps the raw text (plus
 * the cause, which the loop's own conversion drops); `userMessage` carries the
 * sentence.
 */
/**
 * The permission gate's refusal, met inside the tool-call chain rather than at the loop
 * (`chat/runtime/run/chain-gate.ts`): it carries the gate's own result — the sentence the model
 * reads, the one the person sees, whether a person refused — which a hook layer passes on as it
 * passes on any block.
 */
export class PermissionGateBlockedError extends Error {
  readonly result: AgentToolResult
  constructor(result: AgentToolResult) {
    super(result.content)
    this.name = 'PermissionGateBlockedError'
    this.result = result
  }
}

/** A deliberate refusal: a plugin hook, a Claude Code hook, a mod's `{ deny }`, the gate. */
const BLOCKED_ERRORS = new Set([
  'ToolCallBlockedError',
  'CcHookBlockedError',
  'ModToolDeniedError',
  'PermissionGateBlockedError',
])

export function resultFromThrow(toolName: string, error: unknown): AgentToolResult {
  if (error instanceof PermissionGateBlockedError) return error.result
  const err = error instanceof Error ? error : undefined
  const raw = (err?.message ?? String(error)).trim() || 'Tool call failed'
  const cause = err?.cause
  const causeText =
    cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : undefined
  const message = causeText && !raw.includes(causeText) ? `${raw} (cause: ${causeText})` : raw
  const code = (err as { code?: unknown } | undefined)?.code
  const kind: ToolErrorKind =
    err?.name === 'AbortError'
      ? 'aborted'
      : err?.name === 'HumanInLoopDismissedError'
        ? 'dismissed'
        : err?.name === 'HumanInLoopTimeoutError'
          ? 'timeout'
          : BLOCKED_ERRORS.has(err?.name ?? '')
            ? 'blocked'
            : 'execution'
  return {
    content: message,
    isError: true,
    error: {
      kind,
      message,
      userMessage: `The \`${toolName}\` tool failed: ${message}`,
      ...(typeof code === 'string' && code ? { code } : {}),
      retryable: false,
      fatal: false,
    },
  }
}

/**
 * A throw that must stay a throw: the two BLOCK signals.
 *
 * A hook wrapper converts a throw so its own post hooks can see the failure. It must
 * not convert these: they are raised by the pre-hook half of a wrapper (the tool never
 * ran, so there is no result for a post hook to observe), and the failure guard reads
 * them by NAME to stamp `kind:'blocked'`. Swallowing one here would demote a deliberate
 * block to an ordinary execution error.
 */
export function isBlockedThrow(error: unknown): boolean {
  const name = error instanceof Error ? error.name : ''
  return BLOCKED_ERRORS.has(name)
}
