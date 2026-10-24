/**
 * Stage 5 — prompt: the system prompt, and the fixed cost it puts on every request.
 *
 * A per-turn-volatile value above the runtime-context boundary rewrites the provider's prompt
 * cache on every turn without any error, so the prompt is built as a byte-stable cacheable
 * prefix plus keyed runtime sections that become the turn's context inside the conversation,
 * and the prefix is scanned for volatile tokens here. The prefix and the tool schemas are the part of each request the
 * history does not carry; both compression budgets subtract them, so the budget frame is
 * resolved from them in this stage and published on the frame for `context_budget`.
 */
import { createChatCacheDiagnostics } from '@localixai/agent'
import { describeFixedContext } from '@localixai/agent/agents'

import { envFlag } from '../../../../../lib/env'
import { snapshotBackgroundJobs } from '../../agent-runner-state'
import { computeCacheDiagnostics } from '../../cache-diagnostics'
import { warnOnVolatileCachePrefix } from '../../cache-volatility-guard'
import type { RuntimeSection } from '../../../../agent-core/prompt/runtime-sections'
import { resolveContextBudgetFrame } from '../../context-budget'
import { contextWindowDiagnostics, withContextWindowLimits } from '../../context-diagnostics'
import { delegationPlace } from '../../../session-provenance'
import { buildRunSystemPrompt } from '../system-prompt-build'
import { otherWorkspaceSessionsSection } from '../other-workspace-sessions'
import { TOOL } from '../../../../agent-core/tool-names'
import { buildTurnTriggerContext } from '../turn-trigger-context'
import { dumpFixedContext, wireDumpEnabled } from '../wire-dump'
import type { RunInputs } from './context'
import type { RunFrame } from './frame'
import type { RunToolset } from './tools'
import type { ResolvedTurn } from './turn'
import { approvedPlanForRun, planModeForRun } from '../../plan-view'
import { installedAgentsPrompt } from '../../../../external-agents/installed'
import { agentTypesSection } from '../plugin-subagent'
import { withBuiltinSubagentTypes } from '../builtin-subagent-types'
import { touchedInstructionsSection } from '../touched-instructions'

export type RunPrompt = Awaited<ReturnType<typeof buildRunPrompt>>

export async function buildRunPrompt(
  frame: RunFrame,
  turn: ResolvedTurn,
  inputs: RunInputs,
  toolset: RunToolset,
) {
  const { env, params, userId, session, speakerAgentId } = frame
  const { deps } = env
  const { providerId } = turn.model
  const historyMessages = params.historyMessages
  // The descendant snapshot was read earlier in the run; read siblings now so a chat
  // started during preflight can still appear on this turn. Never delay the run on failure.
  const otherChats = await env.repo.listRunningChatWorkspaces(userId).catch(() => [])
  const built = await buildRunSystemPrompt({
    userId,
    session,
    speakerAgentId,
    policy: turn.policy,
    providerId,
    agentProfile: toolset.agentProfile,
    runtimeTools: toolset.runtimeTools,
    // The roster names each tool as the model is offered it (an MCP tool's `modelName`).
    wireToolNames: toolset.tools.map((tool) => tool.modelName ?? tool.name),
    loadedPlugins: inputs.loadedPlugins,
    loadedMiniApps: inputs.loadedMiniApps,
    frozenContext: inputs.frozenContext,
    pinnedSkills: inputs.pinnedSkills,
    triggeredSkills: inputs.triggeredSkills,
    contextFiles: inputs.contextFiles,
    projectStructure: inputs.projectStructure,
    human: inputs.human,
    defaultCwd: inputs.defaultCwd,
    scratchDir: toolset.scratchDir,
    childRuntimeSessions: env.state.childRuntimeSessions,
    descendantSessions: toolset.descendantSessions,
    mcpInstructions: toolset.mcpInstructions,
    mcpInventory: toolset.mcpInventory,
    // Fresh snapshot of THIS session's live background jobs, re-read every turn.
    backgroundJobs: snapshotBackgroundJobs(
      env.state.work,
      userId,
      session.id,
      deps.readTerminalJob,
    ),
    now: deps.now,
    historyMessages,
    // Claude Code mods' `agent.offer`: an agent a mod keeps out is not listed.
    agentDirectory:
      toolset.agentDirectory && (await inputs.mods.offerAgents(toolset.agentDirectory)),
    approvedPlan: await approvedPlanForRun(deps.plans, userId, session),
    // The mode the run was admitted under — the same record its rules were rewritten from.
    planMode: planModeForRun(session, inputs.defaultCwd),
    defaultOutputStyle: turn.globalAgentSettings?.outputStyle,
  })
  const baseSections = built.runtimeSections
  // Claude Code mods' `prompt.section`, `attribution.text` and `prompt.compose`, kept per
  // conversation until a mod invalidates them, so the cached prefix stays byte-stable.
  const systemPrompt =
    (await inputs.mods.composePrompt({
      sections: built.sections,
      model: turn.model.rawModelId,
      tools: toolset.tools,
      outputStyle: built.outputStyle,
    })) ?? built.systemPrompt
  const triggerContext = buildTurnTriggerContext(params.scope, session, historyMessages)
  const installedAgents = (await deps.externalAgents?.installed().catch(() => [])) ?? []
  const externalAgentsText = installedAgentsPrompt(installedAgents)
  if (externalAgentsText && toolset.tools.some((tool) => tool.name === TOOL.bash)) {
    baseSections.push({
      key: 'external-agents:installed',
      scope: 'state',
      text: externalAgentsText,
    })
  }
  // Claude Code's subagent types: the enabled plugins' agents `delegate` runs a task as, past the
  // mods' `agent.offer`.
  const agentTypes = toolset.tools.some((tool) => tool.name === TOOL.delegate)
    ? agentTypesSection(
        await inputs.mods.offerAgents(
          withBuiltinSubagentTypes(inputs.loadedPlugins.agents).map((agent) => ({
            ...agent,
            agentId: agent.fullName,
            name: agent.fullName,
            source: 'plugin' as const,
          })),
        ),
      )
    : null
  if (agentTypes) baseSections.push({ key: 'agent-types', scope: 'state', text: agentTypes })
  // A subdirectory's instruction files and path-scoped rules, once the work reaches them.
  const touchedInstructions = await touchedInstructionsSection({
    cwd: inputs.defaultCwd,
    history: historyMessages,
    loaded: inputs.contextFiles ?? [],
  })
  if (touchedInstructions) baseSections.push(touchedInstructions)
  const otherSessions = otherWorkspaceSessionsSection(
    session,
    inputs.defaultCwd,
    otherChats,
    toolset.runtimeTools.toolNames.includes(TOOL.global_search),
  )
  const runtimeSections: RuntimeSection[] = triggerContext
    ? [
        ...baseSections,
        ...(otherSessions ? [otherSessions] : []),
        { key: 'current-turn', scope: 'turn', text: triggerContext },
      ]
    : [...baseSections, ...(otherSessions ? [otherSessions] : [])]
  // The only default-on detector for a volatile leak into the cacheable prefix; it scans once
  // per prefix change.
  warnOnVolatileCachePrefix(session.id, systemPrompt)
  // Opt-in: the snapshot stableStringifies the FULL history every run — too expensive to pay
  // by default for what is debug telemetry.
  const cacheDiagnostics = envFlag('LOCALIX_CACHE_DIAGNOSTICS')
    ? computeCacheDiagnostics({
        createDiagnostics: createChatCacheDiagnostics,
        session,
        agentId: speakerAgentId,
        historyMessages,
        systemPrompt,
        providerId,
        runtimeTools: toolset.runtimeTools,
      })
    : undefined

  const fixedContext = describeFixedContext(systemPrompt, toolset.tools)
  frame.budget.fixed = fixedContext
  if (wireDumpEnabled()) dumpFixedContext(session.id, systemPrompt, fixedContext.perTool)
  const contextBudgetFrame = resolveContextBudgetFrame({
    contextWindow: turn.catalogModel?.contextLength,
    fixedOverheadTokens: fixedContext.tokens,
    depth: delegationPlace(session.provenance).depth,
    contextLimit: turn.contextLimit,
  })
  frame.budget.frame = contextBudgetFrame
  // The limits ride the run's first snapshot, so the composer's ring has the right denominator
  // from the first request on — not only after the run ends (`withContextWindowLimits`).
  turn.state.payload = withContextWindowLimits(
    turn.state.payload,
    contextWindowDiagnostics(session.id, contextBudgetFrame),
  )
  turn.state.currentPayload = turn.state.payload

  return { systemPrompt, runtimeSections, cacheDiagnostics, fixedContext, contextBudgetFrame }
}
