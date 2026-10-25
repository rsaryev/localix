import type { RuntimeToolRegistry } from '../tool-registry'
import type { RunProfile } from '../run-shape'
import type { RuntimeSection } from './runtime-sections'
import type { ContextFile } from '../context-files'
import type { MemoryUsage } from '../../memory/file-store'
import type { ConversationParticipant } from './sections/conversation'
import type { BackgroundJobSnapshot } from './sections/background-jobs'
import type { ApprovedPlanPrompt } from './sections/plan'

export interface BuildAgentSystemPromptParams {
  modelId?: string
  providerId?: string
  sessionId?: string
  /** Shared objective and prior-topic context, independent of participants and tools. */
  canChangeTopic?: boolean
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
  /** The enabled mini apps' index (`chat/runtime/run/mini-apps-prompt-context.ts`). */
  miniAppsContext?: string
  /**
   * Plugins installed here that nobody has allowed yet, by name.
   *
   * Their code was never imported, so what they would contribute is unknown — which is why
   * they cannot ride the ledger with the withheld TOOLS and are passed separately.
   */
  awaitingConsentPlugins?: readonly string[]
  /** Mini apps installed here and not allowed yet (`mini-app.enable`). */
  awaitingConsentMiniApps?: readonly string[]
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
   * The current roster and elected leader, including a solo chat that may assemble a team.
   */
  conversation?: {
    self: string
    participants: readonly ConversationParticipant[]
    /** This participant is the elected leader and receives orchestration guidance. */
    isLeader?: boolean
    /** The elected leader's handle, recomputed each run; the volatile roster names it. */
    leader?: string
    /** Nobody can be tagged in: it is not a chat. */
    membershipClosed?: boolean
    /**
     * No conversation surrounds the run: a delegated child or a job works for whoever started
     * it, so there is no room to list — no roster to list.
     */
    isolated?: boolean
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
  mcpInventory?: {
    server: string
    tools: string[]
    pending?: boolean
    failed?: boolean
    /** The failed server's connection error, when it reported one. */
    error?: string
  }[]
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
  /** The plan the person approved for this conversation — `# Approved plan`, cached prefix. */
  approvedPlan?: ApprovedPlanPrompt
  /** Set when the run was admitted in plan mode — `# Plan mode`, cached prefix; names the draft. */
  planMode?: { draftPath?: string }
  /**
   * The conversation's output style (Claude Code's `/output-style`): instructions for the role,
   * tone and format of every reply — `# Output style`, cached prefix. Without
   * `keepCodingInstructions` the software-engineering lines of `# Execution discipline` drop out.
   */
  outputStyle?: { name: string; prompt: string; keepCodingInstructions: boolean }
}

/** Structurally separated cache tiers produced by the system-prompt assembler. */
export interface BuiltAgentSystemPromptParts {
  /** Session-invariant prefix suitable for provider prefix caching. */
  stablePrompt: string
  /** The prefix's sections by catalog id, in order: `stablePrompt` is their texts joined. */
  stableSections: { id: string; text: string }[]
  /** Volatile runtime sections, carried inside the conversation as the turn's context. */
  runtimeSections: RuntimeSection[]
}
