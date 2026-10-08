import { createRuntimeToolRegistry, type RuntimeToolRegistry } from './tool-registry'
import { CHAT_RUN_PROFILE, type RunProfile } from './run-shape'
import { ACTIVATE_TOOLS_TOOL_NAME, TOOL } from './tool-names'
import {
  buildRuntimeTailSections,
  RUNTIME_CONTEXT_PROTOCOL,
  type RuntimeSection,
} from './system-prompt-tail'
import { buildProjectContextSection, type ContextFile } from './context-files'
import type { MemoryUsage } from '../memory/file-store'
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
  type ConversationParticipant,
} from './system-prompt-conversation-section'
import { buildCollaborationSection } from './system-prompt-collaboration-section'
import type { BackgroundJobSnapshot } from './system-prompt-sections'
import type { OpenQuestionsState } from './tools/hitl/ask-queue'
import { buildSessionTopicSection } from './session-topic'
import { buildWithheldToolsSection } from './system-prompt-withheld-section'
import {
  ANSWER_FORMS_PRINCIPLE,
  buildAnswerFormatSection,
  rendersAnswerMarkdown,
} from './system-prompt-answer-format-section'
import {
  buildApprovedPlanSection,
  buildPlanModeSection,
  type ApprovedPlanPrompt,
} from './system-prompt-plan-sections'

export interface BuildAgentSystemPromptParams {
  modelId?: string
  providerId?: string
  sessionId?: string
  /** Shared objective and prior-topic context, independent of participants and tools. */
  sessionTopic?: { title: string; goal?: string | null; previousTopicSummary?: string | null }
  /**
   * Absolute inbound-webhook URL for THIS instance (host+port resolved at
   * runtime, so it's correct regardless of the configured port). Emitted in the
   * runtime context beside `Session ID` so the agent can hand an external/
   * delegated process the exact address to message this session back:
   * `POST <webhookUrl>  {"sessionId":"<Session ID>","prompt":"…","source":"…"}`.
   */
  webhookUrl?: string
  now?: () => string
  toolRegistry?: RuntimeToolRegistry
  agentProfile?: RunProfile
  memoryContext?: string
  /** Aggregate char-budget usage across the loaded memory scopes (header line). */
  memoryUsage?: MemoryUsage
  skillsContext?: string
  pinnedSkills?: { name: string; content: string }[]
  /**
   * Skills a keyword in the user's message forced in for THIS turn (see
   * chat/runtime/prompt-skill-triggers.ts). Distinct from `pinnedSkills`, which the user
   * applied to the whole session and which therefore belongs in the cached prefix.
   */
  triggeredSkills?: { name: string; content: string; keyword: string }[]
  /** One compact line per enabled plugin (name + contribution counts). Drives "# Plugins". */
  pluginsContext?: string
  /**
   * Plugins installed here that nobody has allowed yet, by name.
   *
   * Their code was never imported, so what they would contribute is unknown — which is why
   * they cannot ride the ledger with the withheld TOOLS and are passed separately.
   */
  awaitingConsentPlugins?: readonly string[]
  /** Absolute path to the session's working directory (workspace root / sandbox). */
  workspaceRoot?: string
  /** Whether `workspaceRoot` is a git checkout; `false` adds one line that saves a failed `git status`. */
  workspaceIsGitRepo?: boolean
  /**
   * Localix context files (`.localix/context.md` + `.localix/rules/`) discovered
   * from the session cwd by {@link discoverContextFiles} in context-files.ts. Session-stable —
   * rendered as "# Project context" right after "# Workspace".
   */
  contextFiles?: readonly ContextFile[]
  /** Fresh shallow names-only tree. Volatile because agents can change it every turn. */
  projectStructure?: string
  /**
   * Explicit project-level instructions configured in Settings. User-authored,
   * bounded at ingress/runtime, and session-stable for provider prompt caching.
   */
  projectInstructions?: string
  /**
   * The other participants, when this conversation has more than one agent in it. Absent in
   * every private chat, where there is nobody to introduce.
   */
  conversation?: {
    self: string
    participants: readonly ConversationParticipant[]
    /** This participant is the elected leader and receives orchestration guidance. */
    isLeader?: boolean
    /** The person fixed the participants: `conversation_control` schedules, it never invites. */
    rosterLocked?: boolean
  }
  /** Scope-aware agent directory, rendered in the volatile tail so registry edits are immediate. */
  agentDirectory?: readonly {
    id: string
    handle: string
    description?: string
    leadershipPriority: number
    inConversation: boolean
    available: boolean
  }[]
  /** Marks placed since this agent last spoke — a rendered section for the volatile tail. */
  reactionContext?: string
  /**
   * Generic session-scoped scratch directory (UI/feature-agnostic). When set, a
   * "# Scratch space" section tells the agent it has a private temp dir for working
   * files; tools/plugins that render from a file namespace
   * their own subfolder under it. Core states ONLY the generic path — any feature
   * guidance comes from that tool/plugin's own description or prompt section.
   */
  scratchDir?: string
  /**
   * Set when this session is the agent end of an external messaging CHANNEL
   * rather than the workspace UI. Channel-agnostic: the
   * channel host derives it from the session origin, core never names a platform.
   * Drives the "# Channel" section so the model knows its plain reply is relayed
   * back to the user automatically — it must NOT call a send tool or ask for a
   * chat/channel id just to answer here (only to deliver somewhere ELSE).
   */
  deliveryContext?: { channel: string }
  /**
   * Sub-agents of THIS session that are still running when the run starts.
   * Drives the "# Active sub-agents" section so the model avoids overlapping
   * work instead of re-delegating or touching the same files. Volatile —
   * children finish mid-session, so it lives in the dynamic tail.
   */
  activeSubAgents?: { title: string; task?: string }[]
  /**
   * MCP tool names already present in this run's provider tool payload, plus
   * optional servers still connecting. This keeps pending servers distinct from
   * the complete MCP capability surface.
   */
  mcpInventory?: { server: string; tools: string[]; pending?: boolean; failed?: boolean }[]
  /**
   * Per-server MCP capability instructions (the server's `InitializeResult.instructions`,
   * capped 2KB) — CC parity. Volatile (depends on which servers connected this run),
   * so it lives in the dynamic tail beside the MCP tools note.
   */
  mcpInstructions?: { server: string; text: string }[]
  /**
   * Active session-scoped loops (the `/loop` feature) for THIS session. Drives the
   * light "# Loops" section so the model knows it's running inside a loop and how to
   * manage it (reschedule/cancel by id) instead of treating a fire as a one-off or
   * spawning a duplicate loop. Loop-agnostic data — core just renders it. Volatile
   * (loops are created/cancelled mid-session), so it lives in the dynamic tail.
   */
  loopContext?: {
    loops: readonly {
      id: string
      kind: 'fixed' | 'dynamic'
      cadence: string
      prompt: string
    }[]
  }
  /**
   * Live background jobs for THIS session, re-snapshotted EVERY turn so the agent
   * can inspect them on subsequent turns. Volatile → dynamic tail; renders only when
   * at least one job exists.
   */
  backgroundJobs?: BackgroundJobSnapshot[]
  /**
   * The questions THIS participant queued (`ask` with `wait: false`) that are still unanswered,
   * re-read every turn — so it neither re-asks one nor forgets one is outstanding — and the ones
   * the person skipped since it last looked.
   */
  openQuestions?: OpenQuestionsState
  /** The plan the person approved for this conversation — `# Approved plan`, cached prefix. */
  approvedPlan?: ApprovedPlanPrompt
  /** Set when the run was admitted in plan mode — `# Plan mode`, cached prefix; names the draft. */
  planMode?: { draftPath?: string }
}

/** Structurally separated cache tiers produced by the system-prompt assembler. */
export interface BuiltAgentSystemPromptParts {
  /** Session-invariant prefix suitable for provider prefix caching. */
  stablePrompt: string
  /** Volatile runtime sections, carried inside the conversation as the turn's context. */
  runtimeSections: RuntimeSection[]
}

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
  // (system-prompt-tail.ts), because agents invite and remove each other mid-conversation.
  // A solo run gets only the part its inviting turn needs — see system-prompt-conversation-section.
  if (hasTool(TOOL.conversation_control)) {
    sections.push(
      buildTurnControlSection({
        multi: isMultiAgentConversation(params.conversation),
        isLeader: params.conversation?.isLeader ?? false,
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
