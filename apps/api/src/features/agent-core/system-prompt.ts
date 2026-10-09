import { createRuntimeToolRegistry } from './tool-registry'
import { CHAT_RUN_PROFILE } from './run-shape'
import { ACTIVATE_TOOLS_TOOL_NAME, TOOL } from './tool-names'
import { buildRuntimeTailSections, RUNTIME_CONTEXT_PROTOCOL } from './system-prompt-tail'
import { buildProjectContextSection } from './context-files'
import {
  buildRoleSection,
  buildCorePrinciples,
  buildExecutionDiscipline,
  buildMemoryContextSection,
  buildWorkspaceSection,
  buildChannelSection,
  buildSkillsSection,
  buildPinnedSkillsSection,
  buildPluginsSection,
} from './system-prompt-sections'
import {
  buildTurnControlSection,
  isMultiAgentConversation,
} from './system-prompt-conversation-section'
import { buildCollaborationSection } from './system-prompt-collaboration-section'
import { buildSessionTopicSection } from './session-topic'
import { buildWithheldToolsSection } from './system-prompt-withheld-section'
import {
  ANSWER_FORMS_PRINCIPLE,
  buildAnswerFormatSection,
  rendersAnswerMarkdown,
} from './system-prompt-answer-format-section'
import { buildApprovedPlanSection, buildPlanModeSection } from './system-prompt-plan-sections'

import type {
  BuildAgentSystemPromptParams,
  BuiltAgentSystemPromptParts,
} from './system-prompt-contracts'

export type {
  BuildAgentSystemPromptParams,
  BuiltAgentSystemPromptParts,
} from './system-prompt-contracts'

/**
 * Build the cache-stable prompt and volatile runtime tail without parsing rendered text.
 * The string builder below remains the compatibility surface for callers that need the
 * complete prompt.
 */
export function buildAgentSystemPromptParts(
  params: BuildAgentSystemPromptParams = {},
): BuiltAgentSystemPromptParts {
  const toolRegistry = params.toolRegistry ?? createRuntimeToolRegistry()
  const agentProfile = params.agentProfile ?? CHAT_RUN_PROFILE

  // WHO this run is arrives ONE way: on the profile, put there by `resolveRunProfile` from
  // the agent record the host dispatched with. There used to be a second parameter for the
  // same fact — a chat handed its session agent's prompt in as `agentInstructions` while spawn and
  // the other dispatchers put the identical string on the profile — so this line was a `??` between two
  // spellings of one thing, and which won depended on who started the run.
  //
  // Empty means no host passed an agent, which is a host bug rather than a state to paper
  // over: an agent's system prompt is required (`pluginAgentSchema.prompt` is `min(1)`).
  const identity = agentProfile.prompt.identity.trim()

  // PRIMACY: identity, then the invariant "# Core principles", then role/discipline/
  // tools. The most important behavioral rules lead the prompt (and are stated once
  // for every profile via buildCorePrinciples) instead of being buried mid-discipline.
  const rendersAnswers = rendersAnswerMarkdown(agentProfile.shape, params.deliveryContext?.channel)
  // Where the transcript renders the answer forms, using them is a principle, not a reference
  // the model may skip (`ANSWER_FORMS_PRINCIPLE` names the session that showed it skipping).
  const principles = rendersAnswers
    ? `${buildCorePrinciples()}\n${ANSWER_FORMS_PRINCIPLE}`
    : buildCorePrinciples()
  const sections = [
    ...(identity ? [identity] : []),
    principles,
    buildExecutionDiscipline(toolRegistry.toolNames, agentProfile),
    toolRegistry.promptSection,
  ]
  // Every prompt mention of a tool is gated on the REGISTRY, never on anything upstream
  // of it: the registry is the only place that knows what this run actually holds.
  const hasTool = (name: string) => toolRegistry.toolNames.includes(name)
  const roleSection = buildRoleSection(agentProfile, toolRegistry.toolNames)
  // Insert role AFTER the identity (when there is one) and "# Core principles". Computed
  // rather than the literal 2 it used to be: the identity slot is now conditional, and a
  // fixed index would have pushed the role section below execution discipline whenever an
  // agent shipped no persona.
  if (roleSection) sections.splice(sections.indexOf(principles) + 1, 0, roleSection)
  // Who does the work sits beside the role that frames it, before the per-tool discipline.
  const collaboration = buildCollaborationSection(toolRegistry.toolNames, {
    withColleagues: isMultiAgentConversation(params.conversation),
    rosterLocked: params.conversation?.rosterLocked ?? false,
  })
  if (collaboration) {
    const afterRole = sections.indexOf(roleSection ?? principles) + 1
    sections.splice(afterRole, 0, collaboration)
  }

  if (params.workspaceRoot) {
    sections.push(
      buildWorkspaceSection(
        params.workspaceRoot,
        params.agentProfile,
        toolRegistry.toolNames,
        params.workspaceIsGitRepo,
      ),
    )
  }

  // Session-stable: context files change only when the workspace files change,
  // never mid-session — so they sit right after "# Workspace", BEFORE
  // "# Runtime context" (see the cache-order contract above).
  const projectContextSection = buildProjectContextSection(params.contextFiles)
  if (projectContextSection) sections.push(projectContextSection)
  if (params.projectInstructions?.trim()) {
    sections.push(`# Project instructions\n${params.projectInstructions.trim()}`)
  }
  // The conversation's plan: how to work in plan mode, and the plan the person approved.
  for (const section of [
    buildPlanModeSection(hasTool, params.planMode),
    buildApprovedPlanSection(params.approvedPlan, hasTool),
  ])
    if (section) sections.push(section)

  // Session-stable: where this conversation comes from. Set only for sessions
  // driven by an external messaging channel — tells the model
  // its reply is relayed back automatically, so it shouldn't reach for a send
  // tool or a chat id to answer the person it's already talking to.
  if (params.deliveryContext?.channel) {
    sections.push(buildChannelSection(params.deliveryContext.channel))
  }

  // How a turn in this conversation is run. The RULES are prefix-stable (they change when the
  // conversation goes from one agent to several); WHO is in it rides the volatile tail
  // (system-prompt-tail.ts), because agents invite colleagues mid-conversation.
  // A solo run gets only the part its inviting turn needs — see system-prompt-conversation-section.
  if (hasTool(TOOL.conversation_control)) {
    sections.push(
      buildTurnControlSection({
        multi: isMultiAgentConversation(params.conversation),
        isLeader: params.conversation?.isLeader ?? false,
        canChangeTopic: params.canChangeTopic ?? false,
      }),
    )
  }

  // Gate on the `skill` tool actually being present: only the orchestrator has it.
  // Subagents/workers can't call `skill.get`, so listing skills there is pure bloat
  // (up to SKILL_LISTING_BUDGET, ~2k tokens, replayed every turn) AND a desync —
  // the section tells them to retrieve a skill with a tool they don't have. Pinned
  // skills below are inline content (usable without the tool) and stay regardless.
  if (params.skillsContext && toolRegistry.toolNames.includes(TOOL.skill)) {
    const skillsSection = buildSkillsSection(params.skillsContext)
    if (skillsSection) sections.push(skillsSection)
  }

  if (params.pinnedSkills && params.pinnedSkills.length > 0) {
    sections.push(buildPinnedSkillsSection(params.pinnedSkills))
  }

  if (params.pluginsContext) {
    const pluginsSection = buildPluginsSection(
      params.pluginsContext,
      hasTool(ACTIVATE_TOOLS_TOOL_NAME),
    )
    if (pluginsSection) sections.push(pluginsSection)
  }

  // What this run does NOT hold but could: the ledger's remediable withholds, addressed to
  // `configure`. A capability catalog like the two above — it changes with the user's rules,
  // never mid-turn — so it belongs in the cached prefix.
  const withheldSection = buildWithheldToolsSection(
    toolRegistry.ledger,
    toolRegistry.toolNames,
    params.awaitingConsentPlugins ?? [],
  )
  if (withheldSection) sections.push(withheldSection)

  // How the reply is shaped, where the transcript renderer is what the person reads. Placed
  // before the user's own style preferences, which the section defers to.
  if (rendersAnswers) {
    sections.push(buildAnswerFormatSection())
  }

  if (params.memoryContext) {
    const memorySection = buildMemoryContextSection(params.memoryContext, params.memoryUsage)
    if (memorySection) sections.push(memorySection)
  }
  sections.push(RUNTIME_CONTEXT_PROTOCOL)

  // ---- Stable/dynamic boundary. Volatile sections only below this line. ----
  // Everything from "# Runtime context" onward is per-turn / per-session volatile
  // (date, session id, MCP inventory, board, scratch, sub-agents and loops). The run
  // path splits the prompt here (partitionPromptForCache) and moves
  // this tail OUT of the system prompt into an ephemeral end-of-context message, so
  // the system+tools prefix is session-invariant and caches cross-session (esp. for
  // short sessions' turn 1).
  // Session state changes only when its title/objective changes; keep it at the system tail
  // so earlier instructions retain their prefix. Never freeze it in an agent's memory snapshot.
  if (params.sessionTopic) sections.push(buildSessionTopicSection(params.sessionTopic))
  const stablePrompt = sections.join('\n\n').trimEnd()
  return { stablePrompt, runtimeSections: buildRuntimeTailSections(params, hasTool) }
}

/** Mode-specific behavioral guidance injected into the system prompt. */
export function buildAgentSystemPrompt(params: BuildAgentSystemPromptParams = {}): string {
  const { stablePrompt, runtimeSections } = buildAgentSystemPromptParts(params)
  return [stablePrompt, ...runtimeSections.map((section) => section.text)].join('\n\n')
}
