import { agentRoute } from '../../../../contracts/session-route'
/**
 * Per-run system-prompt assembly: gathers the volatile prompt sections
 * (plugins summary, active sub-agents, loop awareness,
 * channel origin), then asks the agent-core builder for its structurally separated
 * cache-stable prompt and volatile runtime tail.
 */
import { resolveWebhookUrl } from '../../../../lib/runtime-address'
import { buildAgentSystemPromptParts } from '../../../agent-core/prompt/assemble'
import type { RuntimeSection } from '../../../agent-core/prompt/runtime-sections'
import { TOOL } from '../../../agent-core/tool-names'
import { onTheWire } from '../../../agent-core/tool-registry'
import { isGitCheckout } from '../../../agent-core/tools/workspace'
import { getLoopEngine } from '../../../loops/runtime-binding'
import { toLoopPromptContext } from '../../../loops/prompt-context'
import type { RunProfile } from '../../../agent-core/run-shape'
import type { LoadedPlugins } from '../../../plugins/loader'
import type { FrozenSessionContext } from '../agent-runner-types'
import type { RuntimeState } from '../agent-runner-state'
import type { PreparedRunContext } from '../prompt-context'
import type { buildRunToolRegistry } from './runtime-tools'
import type { SessionRecord } from '../../repository'
import { buildPluginsPromptContext } from './plugins-prompt-context'
import { buildMiniAppsPromptContext } from './mini-apps-prompt-context'
import type { LoadedMiniApps } from '../../../mini-apps/loader-contract'
import { resolveRunOutputStyle } from './output-style'
import type { RunPolicy } from '../../policy/run-policy'
import { activeDescendantSubagents } from './descendant-roster'
import { runKeepsMemory } from '../../../agent-core/prompt/sections/memory'
import { getAgentService } from '../agent-service-binding'
import { buildReactionContext } from './reaction-context'
import { sessionAgent } from '../message-envelope'
import type { PersistedMessage } from '../../contracts'
import {
  agentDirectoryRows,
  conversationPromptContext,
  type AgentDirectoryEntry,
} from './system-prompt-conversation'
import type { BackgroundJobSnapshot } from '../../../agent-core/prompt/sections/background-jobs'
import type { ApprovedPlanPrompt } from '../../../agent-core/prompt/sections/plan'
import type { McpInventoryEntry } from './mcp-tools'
import type { RunSessionSnapshotRow } from './session-snapshot'

/** Live descendant view for orchestration context; statuses come from durable sessions. */
export interface BuildRunSystemPromptOptions {
  userId: string
  session: SessionRecord
  agentId: string
  /** The run's policy: the agent's route, where the reply goes. */
  policy: RunPolicy
  providerId: string
  agentProfile: RunProfile
  runtimeTools: ReturnType<typeof buildRunToolRegistry>
  /** The tools deferral left on the wire — what the roster and "# Mini apps" describe. */
  wireTools?: readonly { name: string; modelName?: string }[]
  loadedPlugins: LoadedPlugins
  loadedMiniApps: LoadedMiniApps
  frozenContext: FrozenSessionContext
  pinnedSkills: PreparedRunContext['pinnedSkills']
  triggeredSkills: PreparedRunContext['triggeredSkills']
  contextFiles: PreparedRunContext['contextFiles']
  projectStructure?: PreparedRunContext['projectStructure']
  defaultCwd: string
  scratchDir: string
  childRuntimeSessions: RuntimeState['childRuntimeSessions']
  /** Durable sessions let an orchestrator see nested descendants, not just local live maps. */
  descendantSessions?: readonly RunSessionSnapshotRow[]
  /** Per-server MCP capability instructions (CC parity) to surface in the prompt. */
  mcpInstructions?: Array<{ server: string; text: string }>
  /** Direct MCP tools already loaded, plus optional servers still connecting. */
  mcpInventory?: McpInventoryEntry[]
  /** This turn's transcript, for the marks placed on it since this agent last spoke. */
  historyMessages?: readonly PersistedMessage[]
  /** Fresh snapshot of this session's live background jobs (re-read each turn). */
  backgroundJobs?: BackgroundJobSnapshot[]
  /** The plan the person approved for this conversation (`chat/runtime/plan-view.ts`). */
  approvedPlan?: ApprovedPlanPrompt
  /** Set when the run was admitted in plan mode — gates `# Plan mode`, naming the draft file. */
  planMode?: { draftPath?: string }
  agentDirectory?: readonly AgentDirectoryEntry[]
  now?: () => string
  /** The person's default output style across chats (`outputStyle` in Settings). */
  defaultOutputStyle?: string | null
}

export interface BuiltRunSystemPrompt {
  /** The cacheable, session-invariant system prompt (volatile tail removed). */
  systemPrompt: string
  /** The volatile runtime sections, carried in the conversation as the turn's context. */
  runtimeSections: RuntimeSection[]
  /** The cached prompt's sections by id, and the output style it carries (Claude Code mods). */
  sections: readonly { id: string; text: string }[]
  outputStyle: { name: string; isKeepingCodingInstructions: boolean } | null
}

// This instance's inbound-webhook URL, resolved ONCE from env at load (process.env
// is stable at runtime). The resolution rule (loopback-normalize a wildcard bind,
// apply the PORT, append the webhook route path) lives in ONE place — lib/runtime-address.
const WEBHOOK_URL: string = resolveWebhookUrl()

export async function buildRunSystemPrompt(
  options: BuildRunSystemPromptOptions,
): Promise<BuiltRunSystemPrompt> {
  const {
    userId,
    session,
    agentId,
    providerId,
    agentProfile,
    loadedPlugins,
    loadedMiniApps,
    frozenContext,
    pinnedSkills,
    triggeredSkills,
    contextFiles,
    projectStructure,
    defaultCwd,
    scratchDir,
    childRuntimeSessions,
    mcpInstructions,
    mcpInventory,
    now,
  } = options
  const runtimeTools = onTheWire(options.runtimeTools, options.wireTools)
  const route = agentRoute(session)
  if (!route) throw new Error(`Agent is unavailable: ${agentId}`)
  const agent = sessionAgent(session)

  const onWire = new Set(runtimeTools.toolNames)
  const pluginsContext = buildPluginsPromptContext(loadedPlugins, runtimeTools.toolNames)
  const miniAppsContext = buildMiniAppsPromptContext(
    loadedMiniApps,
    runtimeTools.toolNames,
    new Set(options.runtimeTools.toolNames.filter((name) => !onWire.has(name))),
  )
  // Children of THIS session still running when this run starts (e.g. the
  // parent was woken by one sub-agent while others are still working).
  let activeSubAgents = options.descendantSessions
    ? activeDescendantSubagents(options.descendantSessions, session.id)
    : [...childRuntimeSessions.values()].flatMap((c) =>
        c.parentSessionId === session.id &&
        c.session.sessionKind === 'subagent' &&
        c.session.runtimeStatus === 'running'
          ? [{ title: c.session.title }]
          : [],
      )
  if (activeSubAgents.length && runtimeTools.toolNames.includes(TOOL.Agent)) {
    const runs = await getAgentService()
      // The roster prints progress, not spend: skip the per-child usage reads on every turn.
      ?.listDelegatedRuns?.(userId, session.id, { usage: false })
      .catch((error: unknown) => {
        console.warn('[delegate] progress projection unavailable:', error)
        return []
      })
    if (runs)
      activeSubAgents = activeSubAgents.map((child) => {
        const run = runs.find(
          (entry) => entry.sessionId === ('task' in child ? child.task : undefined),
        )
        return run
          ? {
              ...child,
              task: [run.sessionId, run.updatedAt, run.progress].filter(Boolean).join(' · '),
            }
          : child
      })
  }
  // Marks placed since this agent last spoke. A person marks a message and the mark can be the
  // whole of what they said. It rides
  // the tail rather than rewriting the rows that were marked — see `reaction-context`.
  const conversation = conversationPromptContext(options.policy)
  // A session with no agent has nobody to tell — and `sessionAgent` refuses to guess one.
  const reactions = session.agent
    ? buildReactionContext(options.historyMessages ?? [], agent)
    : undefined

  // True only when the tool survived BOTH the profile and disabledTools — the
  // authoritative "can the model call this" signal for prompt-context gating.
  const hasRuntimeTool = (name: string) => runtimeTools.toolNames.includes(name)
  // A channel session's reply is relayed back automatically (`policy/axes/delivery.ts`), so the
  // model must not reach for a send tool to answer the person it is already talking to.
  const channelOrigin = options.policy.delivery.channel

  // Light loop awareness: tell the model which loops are active in this session
  // (id + cadence + task) so a loop fire isn't mistaken for a one-off request and
  // dynamic loops get rescheduled by id instead of duplicated. Engine-resolved via
  // runtime-binding so this module stays decoupled from the loop feature internals.
  const loopContext = toLoopPromptContext(getLoopEngine()?.listForSession(userId, session.id) ?? [])
  // An output style shapes the conversation's own replies, as in Claude Code: a delegated child or
  // a job runs its own prompt, so only a chat run carries it.
  const style =
    agentProfile.shape === 'chat'
      ? await resolveRunOutputStyle({
          chosen: session.outputStyle,
          defaultStyle: options.defaultOutputStyle,
          pluginStyles: loadedPlugins.outputStyles,
          cwd: defaultCwd,
        })
      : null

  const { stablePrompt, stableSections, runtimeSections } = buildAgentSystemPromptParts({
    sessionId: session.id,
    modelId: route.modelId,
    sessionTopic: session,
    providerId,
    webhookUrl: WEBHOOK_URL,
    deliveryContext: channelOrigin ? { channel: channelOrigin } : undefined,
    loopContext,
    backgroundJobs: options.backgroundJobs,
    approvedPlan: options.approvedPlan,
    planMode: options.planMode,
    ...(style
      ? {
          outputStyle: {
            name: style.fullName,
            prompt: style.style.prompt,
            keepCodingInstructions: style.style.keepCodingInstructions,
          },
        }
      : {}),
    now,
    toolRegistry: runtimeTools,
    agentProfile,
    // Frozen per-session snapshot strings (NOT the fresh loads) keep the system prompt
    // byte-identical across the session's runs (prefix cache). Each tool-bound section is
    // gated on the FINAL runtime tool set (toolNames already reflects disabledTools), so a
    // tool turned off also drops its prompt context. The profile is context about the
    // PERSON, not a tool: it rides regardless of the roster.
    // Auto memory, as in Claude Code (`memory-roots.ts` says which runs keep it).
    memory:
      frozenContext.memoryDir && runKeepsMemory(agentProfile, hasRuntimeTool)
        ? {
            dir: frozenContext.memoryDir,
            index: frozenContext.memoryContext ?? '',
            clipped: frozenContext.memoryClipped ?? false,
          }
        : undefined,
    skillsContext: hasRuntimeTool(TOOL.Skill) ? frozenContext.skillsContext : undefined,
    // Pinned skills are already full inline instructions, not an index that
    // requires `skill.get`. Keep them for workers/subagents whose profile does
    // not expose the skill-management tool.
    pinnedSkills,
    // Keyword-triggered, so also full inline instructions — and, unlike pinned skills, they
    // apply to this turn only, which is why they render in the volatile tail.
    triggeredSkills,
    pluginsContext,
    miniAppsContext,
    awaitingConsentPlugins: loadedPlugins.awaitingConsent,
    awaitingConsentMiniApps: loadedMiniApps.awaitingConsent,
    workspaceRoot: defaultCwd,
    workspaceIsGitRepo: isGitCheckout(defaultCwd),
    contextFiles,
    projectStructure,
    projectInstructions: frozenContext.projectInstructions,
    conversation,
    // The agents `Agent` can hand a task to.
    agentDirectory: agentDirectoryRows(options.agentDirectory, {
      canDelegate: hasRuntimeTool(TOOL.Agent),
    }),
    ...(reactions ? { reactionContext: reactions } : {}),
    scratchDir,
    activeSubAgents,
    mcpInstructions,
    mcpInventory,
  })
  // The core assembler owns the cache boundary, so user/runtime content containing
  // a marker-like heading cannot move the partition.
  const outputStyle = style
    ? { name: style.fullName, isKeepingCodingInstructions: !!style.style.keepCodingInstructions }
    : null
  return { systemPrompt: stablePrompt, runtimeSections, sections: stableSections, outputStyle }
}
