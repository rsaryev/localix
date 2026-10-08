/**
 * Stage 4 — tools: the one roster the model sees and the dispatcher executes.
 *
 * A tool the model is shown but the dispatcher cannot run (or the reverse) fails mid-turn with
 * an error the model cannot act on, so exposure and dispatch are derived from ONE descriptor
 * surface here and every later stage — prompt, permission gate, stream — reads this result.
 * The slow reads (MCP gather, the session roster, the agent directory) start as promises
 * before the first await so they overlap instead of queueing behind each other.
 */
import { mkdirSync } from 'node:fs'

import { TOOL } from '../../../../agent-core/tool-names'
import { sessionScratchDir } from '../../../../agent-core/tools/workspace'
import { recordComposition } from '../../../../effective-config/composition-store'
import { recordToolRoster } from '../../../../tools/usage-recorder'
import { isWireResultElided } from '../../agent-runner-state'
import { executionToolSurface } from '../../execution-context'
import { checkpointAtTokens } from '../../model-view/checkpoint-policy'
import { resolveExecutionProfile } from '../../run-profile'
import { isMultiParticipant } from '../../../session-route'
import { createConversationControlPort } from '../conversation-control'
import { requiresConversationControl } from '../runtime-execution'
import { buildRunToolRegistry } from '../runtime-tools'
import { resolveRunDisabledTools } from '../run-tool-policy'
import { surfacePlugins, surfaceTools } from '../surface-tools'
import { assembleRunTools } from '../tool-assembly'
import { assertRunToolRequirements } from '../tool-requirements'
import type { RunInputs } from './context'
import type { RunFrame } from './frame'
import type { ResolvedTurn } from './turn'

export type RunToolset = Awaited<ReturnType<typeof assembleRunToolset>>

export async function assembleRunToolset(frame: RunFrame, turn: ResolvedTurn, inputs: RunInputs) {
  const { env, params, userId, session, budget } = frame
  const { deps, repo, state: runtimeState } = env
  const { state } = turn
  const { defaultCwd, loadedPlugins, ccHooks } = inputs

  const agentProfile = resolveExecutionProfile(session, inputs.agent.instructions, params.scope)
  // Protected orchestration authority comes only from the host, never from the agent.
  const toolSurface = executionToolSurface(params.scope.executionContext)
  const disabledTools = resolveRunDisabledTools(
    inputs.disabledTools,
    params.scope.extraDisabledTools,
  )
  // Topic changes belong to the session, including a fixed solo chat.
  const conversationControl =
    session.sessionKind === 'chat' ||
    (session.sessionKind === 'subagent' && isMultiParticipant(session))
      ? createConversationControlPort(env, params)
      : undefined
  const runtimeTools = buildRunToolRegistry(
    {
      deps,
      repo,
      memoryRepo: env.memoryRepo,
      work: runtimeState.work,
      actionRegistry: runtimeState.actionRegistry,
      terminalWaits: runtimeState.terminalWaits,
      executeToolAction: (toolCallId, actionName, actionPayload) =>
        env.executeToolAction(toolCallId, actionName, actionPayload),
    },
    {
      userId,
      session,
      agentId: inputs.agent.id,
      conversationControl: conversationControl?.finish,
      env: inputs.env,
      defaultCwd,
      catalog: turn.catalog,
      modelInput: turn.modelInput,
      agentSettings: turn.globalAgentSettings,
      skillOverrides: inputs.skillOverrides,
      memoryScope: inputs.agent.context?.memory?.scope,
      disabledTools,
      toolDenials: inputs.toolDenials,
      agentProfile,
      loadedPlugins,
      toolSurface,
      // CC SubagentStart/SubagentStop hooks fire around delegate sub-agent runs.
      ccHooks,
      // Reuse unchanged reads only while this lane still carries them on the wire.
      isResultElided: (toolCallId) => isWireResultElided(frame.stores.context, toolCallId),
      fileMtimes: frame.stores.fileMtimes,
      readDedup: frame.stores.readDedup,
      // Read lazily: the frame is resolved after the registry is built, and the measurement
      // moves with every turn. The model and the usage ring read the same numbers.
      readContextBudget: () =>
        budget.frame
          ? {
              triggerTokens: budget.frame.trigger,
              checkpointAtTokens: checkpointAtTokens(budget.frame),
              policyWindowTokens: budget.frame.effectiveWindow,
              modelWindowTokens: budget.frame.rawWindow,
              reservedTokens: budget.frame.reserve,
              fixedOverheadTokens: budget.frame.fixedOverhead,
              ...(budget.fixed
                ? {
                    fixed: {
                      promptTokens: budget.fixed.promptTokens,
                      toolTokens: budget.fixed.toolTokens,
                      toolCount: tools.length,
                      heaviestTools: budget.fixed.heaviestTools,
                    },
                  }
                : {}),
              ...(state.lastTurnContextTokens
                ? { measuredTokens: state.lastTurnContextTokens }
                : state.initialContextEstimate
                  ? { estimatedTokens: state.initialContextEstimate.tokens }
                  : {}),
            }
          : undefined,
    },
  )

  // Populated from descriptors before any background-capable tool executes.
  const backgroundToolNames = new Set<string>()
  // A crash while a tool that changes something outside this process is in flight is the one
  // interruption where "send again" is not obviously safe, so its dispatch is forced to disk
  // (see `handleToolExecutionStart`).
  const mutatingToolNames = new Set<string>()

  const agentDirectoryPromise =
    deps.listRegistryAgents?.(userId, session.projectId) ?? Promise.resolve([])
  // MCP gather + plugin tool-call hooks + repeat-failure guard, populating the two sets above.
  const assembledPromise = assembleRunTools({
    env,
    userId,
    session,
    agentProfile,
    runtimeTools,
    loadedPlugins,
    ccHooks,
    defaultCwd,
    availability: inputs.availability,
    capabilities: inputs.capabilities,
    modelInput: turn.modelInput,
    disabledTools,
    toolSurface,
    surfaceTools: surfaceTools(surfacePlugins(params.historyMessages), loadedPlugins.loaded),
    backgroundToolNames,
    mutatingToolNames,
  })
  // Answers "why can the model not see my tool" with the values the roster was built from.
  // Failure-proof by construction: a snapshot must never affect the run that produced it.
  void assembledPromise.then(
    (assembled) => recordComposition(session.id, { assembled, loadedPlugins }),
    () => {},
  )

  // The prompt tells the model it may write here, and a shell redirect (`> scratch/out.txt`)
  // does not create directories the way the `write` tool does — two live runs each lost a
  // turn to "No such file or directory" on their own scratch dir before this mkdir.
  const scratchDir = sessionScratchDir(session.id)
  mkdirSync(scratchDir, { recursive: true })

  const [
    { tools, dispatchTools, preflightTools, mcpInstructions, mcpInventory, ledger },
    descendantSessions,
    agentDirectory,
  ] = await Promise.all([assembledPromise, frame.loadSessionSnapshot(), agentDirectoryPromise])
  recordToolRoster(
    preflightTools.map((tool) => tool.name),
    { userId, projectId: session.projectId },
  )
  // `hitl.reachable`: an `ask` on a required operation only stops a run nobody could answer.
  assertRunToolRequirements(
    preflightTools,
    inputs.permissionRules,
    params.scope.requiredTools,
    frame.hitl.reachable,
  )

  return {
    agentProfile,
    runtimeTools: { ...runtimeTools, ledger, toolNames: preflightTools.map((tool) => tool.name) },
    conversationControl,
    backgroundToolNames,
    mutatingToolNames,
    /** Model-visible schemas. */
    tools,
    /** A SUPERSET of `tools`: deferred plugin/MCP implementations stay dispatchable. */
    dispatchTools,
    mcpInstructions,
    mcpInventory,
    descendantSessions,
    agentDirectory,
    scratchDir,
    requiresTurnControl: requiresConversationControl(session.agents.length, dispatchTools),
    recoveryToolAvailable: tools.some((tool) => tool.name === TOOL.tool_output),
  }
}
