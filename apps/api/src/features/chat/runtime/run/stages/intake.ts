/**
 * Stage 6 — intake: the one impure step before the model call, and the gate every tool call
 * passes through.
 *
 * A compact-and-retry that re-fired the plugin prompt rewrite or the CC UserPromptSubmit hook
 * would rewrite or block the same prompt twice, so the impure inputs (the rewrite, the hook,
 * the job/LSP snapshots) are frozen here into a turn frame the pure history pipeline reads,
 * and a retry re-materializes from that frame. The turn limit resolves first because the
 * agent is TOLD it, in the turn it applies to.
 *
 * The permission gate is run-scoped rather than kept across turns: between two turns the user
 * may have granted an approval or changed mode, and a carried-over gate would still refuse.
 */
import { agentModelSettingsFor } from '@localixai/agent'
import { createGateRefusalTracker } from '@localixai/agent/agents'

import { intakeTurn } from '../../history/intake'
import { buildRunPermissionGate } from '../permission-gate-build'
import { runTurnLimitFor } from '../turn-limit'
import type { RunInputs } from './context'
import type { RunFrame } from './frame'
import type { RunPrompt } from './prompt'
import type { RunToolset } from './tools'
import type { ResolvedTurn } from './turn'

export type RunIntake = Awaited<ReturnType<typeof intakeRunTurn>>

export async function intakeRunTurn(
  frame: RunFrame,
  turn: ResolvedTurn,
  inputs: RunInputs,
  toolset: RunToolset,
  prompt: RunPrompt,
) {
  const { env, params, userId, session, speakerAgentId, assistantMessageId } = frame
  const { deps, now } = env
  const { ccHooks, defaultCwd } = inputs
  const modelSettings = agentModelSettingsFor(
    turn.globalAgentSettings?.agentModelSettings,
    speakerAgentId,
    turn.model.providerId,
    turn.catalogModel?.id ?? turn.model.effectiveModelId,
  )
  const maxTurns = runTurnLimitFor(
    inputs.agent,
    params.scope,
    modelSettings?.maxTurns ?? turn.globalAgentSettings?.maxTurns,
  )
  const intake = await intakeTurn({
    deps,
    userId,
    session,
    assistantMessageId,
    maxTurns,
    historyMessages: params.historyMessages,
    loadedPlugins: inputs.loadedPlugins,
    ccHooks,
    ccSessionStartContext: inputs.ccSessionStartContext,
    runtimeSections: prompt.runtimeSections,
    defaultCwd,
    assistantCreatedAt: turn.state.assistantCreatedAt,
    now,
  })
  // A UserPromptSubmit hook denied the prompt (exit 2 / decision:"block"): no model call is
  // made, and the run fails with the hook's reason so the user sees why.
  if (!intake.ok) throw new Error(`Prompt blocked by hook: ${intake.blockedReason}`)

  // permission-gate-breaker.ts documents what the tracker counts.
  const refusalTracker = createGateRefusalTracker()
  const permissionGate = buildRunPermissionGate({
    refusalTracker,
    env,
    userId,
    session,
    agentId: speakerAgentId,
    hitlTargetSessionId: frame.hitl.targetSessionId,
    assistantMessageId,
    abortSignal: frame.abort.signal,
    pluginHooksForRun: frame.teardown.pluginHooks,
    hookRunOptions: inputs.hookRunOptions,
    ccHooks,
    extraAllowedTools: params.scope.extraAllowedTools,
    permissionRules: inputs.permissionRules,
    humanReachable: inputs.humanReachable,
    tools: toolset.dispatchTools,
    defaultCwd,
    hitlWaitedMs: turn.state.hitlWaitedMs,
  })

  return { maxTurns, turnFrame: intake.frame, refusalTracker, permissionGate }
}
