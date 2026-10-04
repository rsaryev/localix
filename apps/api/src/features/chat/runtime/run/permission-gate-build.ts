/**
 * Per-run permission-gate assembly: builds the confirm requester, folds skill
 * `allowed-tools` allow rules after the scope's own ask rules, and constructs the
 * declarative permission gate evaluated at beforeToolCall.
 */
import type { AgentTool, GateRefusalTracker } from '@localixai/agent/agents'

import { createPermissionGate, type PermissionRule } from '../../../agent-core/permission-engine'
import { normalizeCcToolName } from '../../../plugins/discovery'
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
 * Compose the rules for one run: the agent's list, with a skill's `allowed-tools` folded in.
 *
 * A skill may lift a QUESTION, never a REFUSAL. Both are the agent's rules, so the ordering
 * says it: everything that is not a denial, then the skill's allows, then the denials.
 *
 * The middle position is what the skill is for — `tool:bash * ask` followed by `Bash(git *)`
 * means the declared commands stop prompting. The last position is what protects the user: a
 * skill is a file in a repository, and `tool:bash git push* deny` has to survive one arriving
 * that declares `Bash(git *)`. With a single last-match list and no special cases in the
 * evaluator, where a rule sits IS its strength, so the strongest statement goes last.
 */
export function permissionRulesForRun(
  permissionRules: readonly PermissionRule[],
  extraAllowedTools: readonly string[] | undefined,
): PermissionRule[] {
  const skillAllowRules: PermissionRule[] = (extraAllowedTools ?? []).map((spec) => {
    const patternMatch = spec.match(/^([^(]+)\((.+)\)$/)
    if (patternMatch) {
      const bare = normalizeCcToolName(patternMatch[1].trim())
      return { action: 'allow' as const, permission: bare, pattern: patternMatch[2].trim() }
    }
    return { action: 'allow' as const, permission: normalizeCcToolName(spec.trim()), pattern: '*' }
  })
  if (skillAllowRules.length === 0) return [...permissionRules]
  return [
    ...permissionRules.filter((rule) => rule.action !== 'deny'),
    ...skillAllowRules,
    ...permissionRules.filter((rule) => rule.action === 'deny'),
  ]
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

  // Skill `allowed-tools` inject allow rules after broader ask rules so last-match-wins
  // auto-approves the declared calls (while deny remains terminal).
  // Support CC pattern syntax: Bash(git *) → { permission: 'bash', pattern: 'git *' }
  // Also map common CC alias names to engine names (Grep→search, Glob→search, etc.)
  // so skill `allowed-tools: Grep` resolves to the correct engine tool.
  const effectiveRules = permissionRulesForRun(permissionRules, extraAllowedTools)
  const toolsByName = new Map(tools.map((t) => [t.name, t]))

  return createPermissionGate({
    rules: effectiveRules,
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
