/**
 * Shared types + constants for the slash-command handlers. The CommandHandlerContext
 * interface is the closure surface createChatService hands the dispatchers; it and the
 * DirectReply helper type are imported by every per-command handler module
 * (command-handlers-{settings,loop,macros,listings,plugins,providers}). Kept in its
 * own leaf so the dispatcher file (command-handlers.ts) stays focused on dispatch.
 */
import type { ConversationMode } from '../conversation-modes'
import type { ChatServiceDeps } from './context'
import type { SkillRecord } from './skills'
import type { createChatRepository, SessionRecord } from '../repository'
import type { createMemoryRepository } from '../../memory/repository'
import type { createUsageRepository } from '../../usage/repository'
import type { createMcpRepository } from '../../mcp/repository'
import type { createPluginService } from '../../plugins/service'
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
import type { ConversationMembershipChange } from '../runtime/run/conversation-membership'

/**
 * Issues a direct (non-agent) reply, bound to the current turn by the caller
 * (handleControlCommand's `directReply` closure). Passed to the extracted
 * per-command handlers so they share one reply shape.
 */
export type DirectReply = (text: string) => Promise<MessageMutationResponse>

/**
 * Shared busy-guard message for the command handlers that mutate context or
 * start a run — they all reject mid-run with the same "stop first" wording.
 */
export const BUSY_STOP_FIRST = 'Session is busy — stop the current run first'

/**
 * Everything the slash-command handlers need from the createChatService
 * closure — repos, services, and the shared sendMessage helpers. The lock
 * (withSessionMutationLock) stays in sendMessage; handlers run inside it.
 */
export interface CommandHandlerContext {
  changeAgentMembership: (
    userId: string,
    sessionId: string,
    change: { invite?: string[]; remove?: string[] },
  ) => Promise<ConversationMembershipChange>
  /**
   * Make the conversation a group (or solo) the way the composer does: the mode is written, the
   * participants read the line saying so, and a colleague chain left from a group is dropped.
   */
  setConversationMode: (userId: string, sessionId: string, mode: ConversationMode) => Promise<void>
  deps: ChatServiceDeps
  repo: ReturnType<typeof createChatRepository>
  usageRepo: ReturnType<typeof createUsageRepository>
  memoryRepo: ReturnType<typeof createMemoryRepository>
  mcpRepo: ReturnType<typeof createMcpRepository>
  pluginService: ReturnType<typeof createPluginService>
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
  /** One shared settings seam for slash invocation and `/skills` listing. */
  /**
   * Skill visibility for a scope. Takes the project because visibility is a scope fact — the
   * global-only read this replaces gave a project session the wrong answer.
   */
  /**
   * Skill visibility for a scope. Takes the names it is deciding about: a verdict is per
   * capability, so a map can only be built for a roster someone has already discovered.
   */
  loadSkillOverrides: (
    userId: string,
    projectId: string | null,
    names: readonly string[],
  ) => Promise<SkillOverrides>
  gatherEnabledPluginCommands: (
    userId: string,
    session: SessionRecord,
  ) => Promise<Array<{ plugin: string; command: PluginCommand; pluginDir: string }>>
  resolveSessionWorkingDir: (userId: string, session: SessionRecord) => Promise<string>
  /**
   * Spawn a delegated session from the skill task and agent selection;
   * returns the child session ID.
   */
  spawnForkSkill?: SpawnForkSkillFn
  buildSessionPluginCatalog: (userId: string, session: SessionRecord) => Promise<PluginCatalog>
}
