/**
 * Per-run permission-gate assembly: builds the confirm requester, folds skill
 * `allowed-tools` into task-local preapprovals, and constructs the
 * declarative permission gate evaluated at beforeToolCall.
 */
import type { AgentTool, GateRefusalTracker } from '@localixai/agent/agents'

import { createPermissionGate, type PermissionRule } from '../../../agent-core/permission-engine'
import { normalizeCcToolName } from '../../../plugins/discovery'
import { nativeCommandPatterns } from '../../../cc-settings/native-command-patterns'
import { createConfirmRequester } from './confirm-requester'
import { ownPlanDirForRun } from '../plan-view'
import type { RunHookContext } from './run-hook-context'

export interface BuildRunPermissionGateOptions extends RunHookContext {
  abortSignal: AbortSignal
  /** Skill `allowed-tools` for this run only (CC pattern syntax supported). */
  extraAllowedTools: string[] | undefined
  /** Session/project-level permission rules from prompt-context. */
  permissionRules: PermissionRule[]
  /** False when the session's mode expects nobody to answer (`permission-mode-policy.ts`). */
  humanReachable?: boolean
  /** Final dispatch descriptors, including MCP and deferred implementations. */
  tools: readonly AgentTool[]
  defaultCwd: string
  /** Run-scoped refusal memory; the run reads its verdict as a stop condition. */
  refusalTracker?: GateRefusalTracker
  /**
   * The run's closed-wait ledger (`RunTurnState.hitlWaitedMs`). A permission card is a human
   * wait exactly like an `ask`, but it is raised by the gate, not by a tool, so without this the
   * approval latency was booked as TOOL time — a 12s `find` read as 233s.
   */
  hitlWaitedMs?: Map<string, number>
}

/**
 * Translate skill declarations without rewriting the agent's ordered policy. The permission
 * evaluator applies these only to eligible questions after deciding the authored verdict.
 */
export function skillPermissionRules(
  extraAllowedTools: readonly string[] | undefined,
): PermissionRule[] {
  return (extraAllowedTools ?? []).flatMap((spec): PermissionRule[] => {
    const patternMatch = spec.match(/^([^(]+)\((.+)\)$/)
    if (patternMatch) {
      const bare = normalizeCcToolName(patternMatch[1].trim())
      const specifier = patternMatch[2].trim()
      const patterns = bare === 'bash' ? nativeCommandPatterns(specifier) : [specifier]
      return patterns.map((pattern) => ({ action: 'allow', permission: bare, pattern }))
    }
    return [{ action: 'allow', permission: normalizeCcToolName(spec.trim()), pattern: '*' }]
  })
}

export function buildRunPermissionGate(
  options: BuildRunPermissionGateOptions,
): ReturnType<typeof createPermissionGate> {
  const {
    env,
    userId,
    session,
    agentId,
    hitlTargetSessionId,
    assistantMessageId,
    abortSignal,
    pluginHooksForRun,
    hookRunOptions,
    ccHooks,
    extraAllowedTools,
    permissionRules,
    tools,
    defaultCwd,
  } = options

  // One declarative engine (workspace boundary, dangerous commands, scope rules)
  // evaluated at beforeToolCall.
  const requestConfirm = createConfirmRequester({
    env,
    userId,
    session,
    agentId,
    hitlTargetSessionId,
    assistantMessageId,
    abortSignal,
    pluginHooksForRun,
    hookRunOptions,
    ccHooks,
    ...(options.hitlWaitedMs ? { hitlWaitedMs: options.hitlWaitedMs } : {}),
  })

  const toolsByName = new Map(tools.map((t) => [t.name, t]))

  return createPermissionGate({
    rules: permissionRules,
    preapprovedRules: skillPermissionRules(extraAllowedTools),
    toolsByName,
    root: defaultCwd,
    // The conversation's own plan directory: a plan-shaped write anywhere else is a file write.
    ownPlanDir: ownPlanDirForRun(session, defaultCwd),
    // Two ways nobody answers a card: a parentless automation job has no chat to show it in,
    // and an autonomous session has a chat nobody is expected to watch. Either way an `ask` must
    // refuse with the unattended-run message rather than wait out a deadline. (A parented job
    // routes to its verified root chat.)
    requestConfirm:
      options.humanReachable === false ||
      (session.sessionKind === 'job' &&
        (!hitlTargetSessionId || hitlTargetSessionId === session.id))
        ? undefined
        : requestConfirm,
    ...(options.refusalTracker ? { refusalTracker: options.refusalTracker } : {}),
  })
}
