/**
 * The added events whose handlers can change what happens next: a command expansion, an
 * approval card, an automatic denial, a tool batch, a task-board write, a member going idle.
 * Each fold follows the CC reference's decision control for its event.
 */
import { absoluteFilePaths, claudeCodeHookCall, localInputFromHook } from '../ext/cc-tool-shapes'
import type { CcHookInput, CcHookOutcome } from './contracts'
import { matchesField, matchesToolName } from './matcher'
import type {
  CcAddedHooksRuntime,
  CcTask,
  PermissionRequestResult,
} from './runtime-contracts-added'
import { contextFrom, joinContext } from './runtime-results'
import { toolRefOf, type HookDispatchDeps } from './runtime-tool-hooks'
import { runInParallel } from './runtime-parallel'

type GateRunners = Pick<
  CcAddedHooksRuntime,
  | 'runUserPromptExpansion'
  | 'runPermissionRequest'
  | 'runPermissionDenied'
  | 'runPostToolBatch'
  | 'runTaskCreated'
  | 'runTaskCompleted'
  | 'runTeammateIdle'
>

const all = () => true

/** Exit 2, `decision:"block"`, or a prompt/agent verdict mapped to a tool deny. */
function refuses(o: CcHookOutcome): boolean {
  return Boolean(o.blocked || o.decision === 'block' || o.permissionDecision === 'deny')
}
const reasonOf = (o: CcHookOutcome) =>
  o.blockReason || o.reason || o.permissionDecisionReason || o.stopReason

/** A session-derived team name, CC's deprecated `team_name`. */
const teamName = (sessionId: string) => `session-${sessionId.slice(0, 8)}`

export function createGateHookRunners(deps: HookDispatchDeps): GateRunners {
  const { select, runHandler, fireAsync, runAll, baseInput } = deps
  // CC's deprecated `team_name`, derived from the session as CC derives it.
  const team = teamName(baseInput('TeammateIdle').session_id)

  /** The task events share an input shape and a fold; only `continue:false` differs (ignored). */
  async function runTask(event: 'TaskCreated' | 'TaskCompleted', task: CcTask) {
    const input: CcHookInput = {
      ...baseInput(event),
      task_id: task.id,
      task_subject: task.subject,
      ...(task.description ? { task_description: task.description } : {}),
      ...(task.teammateName ? { teammate_name: task.teammateName } : {}),
      team_name: team,
    }
    let blocked = false
    let reason: string | undefined
    for (const o of await runAll(event, all, input, false)) {
      if (event === 'TaskCompleted' ? o.blocked || o.permissionDecision === 'deny' : refuses(o)) {
        blocked = true
        reason = reasonOf(o) ?? reason
      }
    }
    return { blocked, ...(reason ? { reason } : {}) }
  }

  return {
    async runUserPromptExpansion(expansion) {
      // Stops at the first blocking handler, like UserPromptSubmit.
      const selected = select('UserPromptExpansion', (m) => matchesField(m, expansion.commandName))
      if (!selected) return { blocked: false }
      const input: CcHookInput = {
        ...baseInput('UserPromptExpansion'),
        expansion_type: 'slash_command',
        command_name: expansion.commandName,
        command_args: expansion.commandArgs,
        command_source: expansion.commandSource,
        prompt: expansion.prompt,
      }
      fireAsync(selected.async, input)
      const contexts: (string | undefined)[] = []
      const outcomes = await runInParallel(selected.sync, (h) =>
        runHandler('UserPromptExpansion', h, input, true),
      )
      for (const o of outcomes) {
        if (refuses(o) || o.continue === false) {
          return { blocked: true, reason: reasonOf(o) || 'Command blocked by hook' }
        }
        contexts.push(o.additionalContext)
      }
      return { blocked: false, additionalContext: joinContext(contexts) }
    },

    async runPermissionRequest(tool, toolInput, opts) {
      const ref = toolRefOf(tool)
      const toolName = ref.name
      const base = baseInput('PermissionRequest')
      const input: CcHookInput = {
        ...base,
        ...claudeCodeHookCall(ref, toolInput, base.cwd),
        ...(opts?.suggestions?.length ? { permission_suggestions: opts.suggestions } : {}),
      }
      const outcomes = await runAll(
        'PermissionRequest',
        (m) => matchesToolName(m, toolName, ref.aliases, toolInput),
        input,
        false,
        { ifCtx: { toolName, toolInput, aliases: ref.aliases, cwd: base.cwd } },
      )
      // Only the `decision` object decides (exit 2 is not honoured); a deny from any handler
      // beats an allow from another, and the first allow's rewrite is the one applied.
      let result: PermissionRequestResult = {}
      for (const { permissionRequest: d } of outcomes) {
        if (!d) continue
        if (d.behavior === 'deny') return d
        if (!result.behavior) result = d
      }
      // The hook rewrote the call in Claude Code's shape: fold it back into Localix's.
      return result.updatedInput !== undefined
        ? {
            ...result,
            updatedInput: localInputFromHook(toolName, toolInput, result.updatedInput, base.cwd),
          }
        : result
    },

    async runPermissionDenied(tool, toolInput, toolUseId, reason) {
      const ref = toolRefOf(tool)
      const toolName = ref.name
      const base = baseInput('PermissionDenied')
      const input: CcHookInput = {
        ...base,
        ...claudeCodeHookCall(ref, toolInput, base.cwd),
        tool_use_id: toolUseId,
        reason,
      }
      const outcomes = await runAll(
        'PermissionDenied',
        (m) => matchesToolName(m, toolName, ref.aliases, toolInput),
        input,
        false,
        { ifCtx: { toolName, toolInput, aliases: ref.aliases, cwd: base.cwd } },
      )
      return { retry: outcomes.some((o) => o.retry === true) }
    },

    async runPostToolBatch(calls) {
      const base = baseInput('PostToolBatch')
      // File paths absolute, as every tool event carries them (hooks.md, PreToolUse input).
      const toolCalls = calls.map((call) => ({
        ...call,
        tool_input: absoluteFilePaths(call.tool_name, call.tool_input, base.cwd),
      }))
      const input: CcHookInput = { ...base, tool_calls: toolCalls }
      const outcomes = await runAll('PostToolBatch', all, input, false)
      const stopping = outcomes.filter((o) => refuses(o) || o.continue === false)
      const additionalContext = contextFrom(outcomes)
      const reason = stopping.map(reasonOf).find(Boolean)
      // The run ends here, and nothing after it may restart the agent (`stoppedBy`).
      if (stopping.length > 0)
        deps.stopRun?.({
          event: 'PostToolBatch',
          reason: reason || 'A PostToolBatch hook stopped the run.',
        })
      return {
        stop: stopping.length > 0,
        ...(stopping.length ? { reason } : {}),
        ...(additionalContext ? { additionalContext } : {}),
      }
    },

    runTaskCreated: (task) => runTask('TaskCreated', task),
    runTaskCompleted: (task) => runTask('TaskCompleted', task),

    async runTeammateIdle(teammate) {
      const input: CcHookInput = {
        ...baseInput('TeammateIdle'),
        teammate_name: teammate.name,
        team_name: team,
        agent_id: teammate.agentId,
      }
      let blocked = false
      let reason: string | undefined
      let stopReason: string | undefined
      for (const o of await runAll('TeammateIdle', all, input, false)) {
        if (o.continue === false) stopReason = o.stopReason || stopReason || 'Stopped by hook'
        else if (o.blocked || o.decision === 'block') {
          blocked = true
          reason = reasonOf(o) ?? reason
        }
      }
      // `continue:false` stops the member outright, whatever another handler asked.
      if (stopReason) return { blocked: false, stopReason }
      return { blocked, ...(reason ? { reason } : {}) }
    },
  }
}
