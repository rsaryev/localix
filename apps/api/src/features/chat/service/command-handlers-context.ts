import type { PermissionRule } from '../../agent-core/permission-engine'
/**
 * Shared types + constants for the slash-command handlers. The CommandHandlerContext
 * interface is the closure surface createChatService hands the dispatchers; it and the
 * DirectReply helper type are imported by every per-command handler module
 * (command-handlers-{settings,loop,listings,plugins,mini-apps,agents}). Kept in its
 * own leaf so the dispatcher file (command-handlers.ts) stays focused on dispatch.
 */
import type { ChatServiceDeps } from './context'
import type { SkillRecord } from './skills'
import type { SkillShellPolicy } from './skill-render'
import type { createChatRepository, SessionRecord } from '../repository'
import type { AvailabilityWriter } from '../../capabilities/availability'
import type { createUsageRepository } from '../../usage/repository'
import type { createMcpRepository, McpServerRecord } from '../../mcp/repository'
import type { createPluginService } from '../../plugins/service'
import type { MiniAppService } from '../../mini-apps/service'
import type { PluginCommand } from '../../plugins/contracts'
import type { AgentRunner } from '../runtime/agent-runner'
import type {
  MessageMutationResponse,
  MessageBinding,
  MessageInvocationBinding,
} from '../contracts'
import type { ToolSurface } from '@localixai/agent/agents'
import type { PluginCatalog } from '../../plugins/catalog'
import type { SkillOverrides } from '../../agent-core/skill-overrides'
import type { ToolRequirement } from '../../agent-core/required-tools'
import type { StoredCommandOutput, StoredSystemNotice } from '../../../db'
import type { ExistingMessages, RunAgentOptions } from './run-agent'
import type { SpawnForkSkillFn } from './fork-skill'
import type { RecapService } from '../recap/service'

/**
 * Issues a direct (non-agent) reply, bound to the current turn by the caller
 * (handleControlCommand's `directReply` closure). Passed to the extracted
 * per-command handlers so they share one reply shape.
 */
export type DirectReply = (text: string) => Promise<MessageMutationResponse>

/**
 * Everything the slash-command handlers need from the createChatService
 * closure — repos, services, and the shared sendMessage helpers. The lock
 * (withSessionMutationLock) stays in sendMessage; handlers run inside it.
 */
export interface CommandHandlerContext {
  deps: ChatServiceDeps
  repo: ReturnType<typeof createChatRepository>
  usageRepo: ReturnType<typeof createUsageRepository>
  mcpRepo: ReturnType<typeof createMcpRepository>
  availabilityWriter: AvailabilityWriter
  pluginService: ReturnType<typeof createPluginService>
  miniAppService: MiniAppService
  runner: AgentRunner
  now: () => string
  publishSession: (session: SessionRecord) => void
  insertDirectReply: (
    userId: string,
    sessionId: string,
    userPrompt: string,
    replyText: string,
    timestamp: string,
    /** The reply's tone when the handler knows it; otherwise read from the text. */
    tone?: StoredCommandOutput['tone'],
  ) => Promise<MessageMutationResponse>
  insertSystemNotice: (
    userId: string,
    sessionId: string,
    notice: StoredSystemNotice,
    timestamp: string,
    /** True for a standalone slash command; false when a real agent turn follows. */
    settleOptimistic: boolean,
  ) => Promise<MessageMutationResponse>
  /** The session recap (`/recap`): written on demand, whatever the automatic switch says. */
  recap: RecapService['recap']
  runMacroCommand: (
    userId: string,
    sessionId: string,
    session: SessionRecord,
    existingMessages: ExistingMessages,
    visiblePrompt: string,
    instruction: string,
    timestamp: string,
    opts?: {
      extraDisabledTools?: string[]
      extraAllowedTools?: string[]
      requiredTools?: readonly ToolRequirement[]
      commandOrigin?: { command: string; label: string }
      toolSurface?: ToolSurface
      bindings?: MessageBinding[]
      invocation?: Omit<MessageInvocationBinding, 'kind' | 'id' | 'instruction'>
    },
  ) => Promise<MessageMutationResponse>
  runAgent: (
    userId: string,
    sessionId: string,
    session: SessionRecord,
    existingMessages: ExistingMessages,
    prompt: string,
    timestamp: string,
    bindings?: MessageBinding[],
    opts?: RunAgentOptions,
  ) => Promise<MessageMutationResponse>
  gatherSessionSkills: (userId: string, session: SessionRecord) => Promise<SkillRecord[]>
  /** The agent's permission rules a typed skill's commands meet; absent, none are checked. */
  loadSkillCommandRules?: (userId: string, agentId: string) => Promise<PermissionRule[]>
  /** `disableSkillShellExecution` for a skill or command about to render (`skill-render.ts`). */
  skillShellDisabled?: SkillShellPolicy
  /**
   * Skill visibility for a scope: one shared settings seam for slash invocation and `/skills`
   * listing. Takes the project because visibility is a scope fact — the global-only read this
   * replaces gave a project session the wrong answer — and the names it is deciding about: a
   * verdict is per capability, so a map can only be built for a roster someone has already
   * discovered.
   */
  loadSkillOverrides: (
    userId: string,
    projectId: string | null,
    names: readonly string[],
  ) => Promise<SkillOverrides>
  gatherEnabledPluginCommands: (
    userId: string,
    session: SessionRecord,
  ) => Promise<
    Array<{ plugin: string; command: PluginCommand; pluginDir: string; dataDir?: string }>
  >
  /** Enabled plugins' skills, named `<plugin>:<skill>` (`session-workspace.ts`). */
  gatherEnabledPluginSkills: (userId: string, session: SessionRecord) => Promise<SkillRecord[]>
  resolveSessionWorkingDir: (userId: string, session: SessionRecord) => Promise<string>
  /**
   * Spawn a delegated session from the skill task and agent selection;
   * returns the child session ID.
   */
  spawnForkSkill?: SpawnForkSkillFn
  buildSessionPluginCatalog: (userId: string, session: SessionRecord) => Promise<PluginCatalog>
  /** The MCP servers the session's enabled plugins bundle (`/mcp` lists and reconnects them). */
  loadSessionPluginMcpServers: (
    userId: string,
    session: SessionRecord,
  ) => Promise<McpServerRecord[]>
}
