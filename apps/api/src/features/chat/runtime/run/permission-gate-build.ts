/**
 * Per-run permission-gate assembly: builds the confirm requester, folds skill
 * `allowed-tools` into task-local preapprovals, and constructs the
 * declarative permission gate evaluated at beforeToolCall.
 */
import type { AgentTool, GateRefusalTracker } from '@localixai/agent/agents'

import { createPermissionGate, type PermissionRule } from '../../../agent-core/permission-engine'
import {
  verdictOf,
  type CallVerdict,
  type OuterRules,
  type ReviewVerdict,
  type VerdictOptions,
} from '../../../agent-core/permission-verdict'
import { claudeCodeAllowRules, claudeCodeDenyRules } from '../../../cc-settings/cc-rule-translate'
import { createConfirmRequester } from './confirm-requester'
import { ownPlanDirForRun } from '../plan-view'
import type { RunHookContext } from './run-hook-context'

export interface BuildRunPermissionGateOptions extends RunHookContext {
  abortSignal: AbortSignal
  /** Skill `allowed-tools` for this run only (CC pattern syntax supported). */
  extraAllowedTools: string[] | undefined
  /** Session/project-level permission rules from prompt-context. */
  permissionRules: PermissionRule[]
  /**
   * Whether a confirm card may be raised at all (`policy.human.canAnswer`). When it may not, an
   * `ask` verdict refuses with the unattended-run message instead of waiting out a deadline or
   * reporting that a person declined a card nobody showed them.
   */
  mayConfirm: boolean
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
  /** Stop the run (a PermissionRequest hook's `interrupt`). */
  stopRun?: () => void
  /**
   * Claude Code mods' `tool.check`: `review` sees each verdict before the gate acts on it, and the
   * gate's own verdict is lent for a mod's `$.tool.check`, which runs nothing.
   */
  toolCheck?: {
    review?: ReviewVerdict
    lend(verdict: (toolName: string, input: unknown) => CallVerdict): void
  }
  /** The person's Claude Code `permissions`, as the gate's outer rule set. */
  outerRules?: OuterRules
  /** Claude Code's `additionalDirectories`: further working directories. */
  extraRoots?: readonly string[]
  /**
   * `Tool(specifier)` entries of an agent's or a skill's `disallowed-tools`: each denies the calls
   * it matches and leaves the tool to every other call. Appended after the authored rules, so
   * they win.
   */
  denyPatterns?: readonly string[]
  /** Claude Code's settings `allow` rules as pre-approvals, beside a skill's `allowed-tools`. */
  preapprovedRules?: readonly PermissionRule[]
  /** Receives the gate's inputs: a skill the model loads checks its injected commands on them. */
  onVerdictOptions?: (options: VerdictOptions) => void
}

/**
 * Translate skill declarations without rewriting the agent's ordered policy. The permission
 * evaluator applies these only to eligible questions after deciding the authored verdict.
 * A rule reads as Claude Code reads it (`cc-settings/cc-rule-translate.ts`); given the run's
 * working directory, its path patterns anchor there, as the call's paths do.
 */
export function skillPermissionRules(
  extraAllowedTools: readonly string[] | undefined,
  cwd?: string,
): PermissionRule[] {
  return (extraAllowedTools ?? []).flatMap((spec) => claudeCodeAllowRules(spec, cwd))
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
    miniAppHooksForRun,
    hookRunOptions,
    ccHooks,
    extraAllowedTools,
    permissionRules,
    tools,
    defaultCwd,
  } = options

  // A hook reads a tool by its Claude Code names (an MCP tool's `mcp__…`), which the tool carries.
  const toolsByName = new Map(tools.map((t) => [t.name, t]))
  const hookTool = (name: string) => toolsByName.get(name) ?? name

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
    miniAppHooksForRun,
    hookRunOptions,
    ccHooks,
    hookTool,
    ...(options.hitlWaitedMs ? { hitlWaitedMs: options.hitlWaitedMs } : {}),
    ...(options.stopRun ? { stopRun: options.stopRun } : {}),
  })

  const verdictOptions = {
    // The run's OWN copy: a skill the model loads appends its `disallowed-tools` to it for the
    // rest of this run (`skill-turn-grants.ts`), and the authored list may be a cached snapshot.
    rules: [
      ...permissionRules,
      ...(options.denyPatterns ?? []).flatMap((spec) =>
        claudeCodeDenyRules(spec, defaultCwd, undefined, DENY_PATTERN_MESSAGE),
      ),
    ],
    preapprovedRules: [
      ...skillPermissionRules(extraAllowedTools, defaultCwd),
      ...(options.preapprovedRules ?? []),
    ],
    toolsByName,
    root: defaultCwd,
    // The conversation's own plan directory: a plan-shaped write anywhere else is a file write.
    ownPlanDir: ownPlanDirForRun(session, defaultCwd),
    ...(options.outerRules ? { outerRules: options.outerRules } : {}),
    ...(options.extraRoots ? { extraRoots: options.extraRoots } : {}),
  }
  options.toolCheck?.lend(verdictOf(verdictOptions))
  options.onVerdictOptions?.(verdictOptions)

  return createPermissionGate({
    ...verdictOptions,
    ...(options.toolCheck?.review ? { reviewVerdict: options.toolCheck.review } : {}),
    // Nobody answers a card when no verified chat can show it (a parentless job, broken ancestry)
    // or when the session is autonomous and nobody watches it (`policy/axes/human.ts`).
    requestConfirm: options.mayConfirm ? requestConfirm : undefined,
    ...(options.refusalTracker ? { refusalTracker: options.refusalTracker } : {}),
    // CC PermissionDenied: a refusal made without asking anyone; `retry` tells the model it may
    // try the call again (the refusal itself stands).
    ...(ccHooks.hasHooks('PermissionDenied')
      ? {
          reviewAutomaticDenial: async (call, reason) =>
            (
              await ccHooks.runPermissionDenied(
                hookTool(call.toolName),
                call.input,
                call.toolCallId,
                reason,
              )
            ).retry
              ? PERMISSION_RETRY_NOTE
              : undefined,
        }
      : {}),
  })
}

const DENY_PATTERN_MESSAGE = "This call is on the run's disallowed-tools list."

/** What the model reads when a PermissionDenied hook returned `retry: true`. */
export const PERMISSION_RETRY_NOTE =
  '[A permission hook reviewed this refusal: you may retry this tool call.]'
