import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { buildPluginCatalog, type PluginCatalog } from '../../plugins/catalog'
import { loadEnabledPlugins } from '../../plugins/loader'
import type { McpServerRecord } from '../../mcp/repository'
import { listEnabledPluginWorkflows } from '../../plugins/workflow-commands'
import type { createProjectsRepository } from '../../projects/repository'
import type { SessionRecord } from '../repository'
import { projectWorkingDirPort, resolveBaseSessionCwd } from '../session-cwd'
import { userHome } from '../../../lib/env'
import type { AvailabilityReader } from '../../capabilities/availability'
import type { CapabilitySourceRepository } from '../../capabilities/source-repository'
import {
  readClaudeSettingsSync,
  scopeSkills,
  sessionSkills,
  type ScopeSkills,
  type ChatPluginSessions,
  type LocalixPluginHost,
} from '../../plugins/kit'
import type { PluginSession as KitSession, SessionSkill } from '@rsaryev/llx-plugin'
import { kitPluginsOf } from '../../plugins/catalog-kit'
import { claudeCodeHome } from '../../cc-settings/config-dir'
import { openChatPluginSession } from '../runtime/run/chat-plugin-session'
import { ccTranscriptPath } from '../runtime/run/cc-transcript'

export interface SessionWorkspaceDeps {
  projectsRepo: ReturnType<typeof createProjectsRepository>
  pluginRepo: CapabilitySourceRepository
  pluginHost: LocalixPluginHost
  /** The chats' kit sessions (`createChatPluginSessions`); absent in a host without plugins. */
  pluginSessions?: ChatPluginSessions
  /**
   * What an AGENT's rules say about its plugins. A PORT because this module owns no
   * storage — the same reason the repositories above are injected — and because the
   * composition root is the only place that can bind the rule store.
   */
  availabilityFor: (userId: string, agentId: string) => Promise<AvailabilityReader>
  logger?: { warn: (message: string, meta?: unknown) => void }
}

/**
 * The agent whose rules answer for this session.
 *
 * The session's agent is the one whose turn a plugin's contribution would land in.
 * A record with no agent yet — a session being assembled, a fixture — answers with the
 * agent that always exists, so discovery never has to represent "nobody to ask".
 */
const agentOf = (session: SessionRecord): string => session.agent?.agentId || DEFAULT_AGENT_ID

/**
 * Resolves a session's filesystem working directory and the capabilities
 * (skills, plugin commands, plugin catalog) visible from it. Pulled out of the
 * chat service so the workspace-rooting + discovery logic lives in one place.
 */
export function createSessionWorkspace(deps: SessionWorkspaceDeps) {
  const { projectsRepo, pluginRepo, pluginHost, pluginSessions, availabilityFor, logger } = deps

  /** Resolves a project's working dir (for filesystem skill discovery). */
  const resolveProjectWorkingDir = projectWorkingDirPort(projectsRepo)

  /**
   * Resolves the directory a session's file operations are rooted at. Delegates to
   * the single `resolveBaseSessionCwd` seam (shared with the agent run path's
   * `defaultCwd`): the project
   * working_dir, else the session sandbox (~/.localix/workspace/{rootId}). Never
   * falls back to process.cwd() — the directory the API was launched from must not leak in.
   */
  const resolveSessionWorkingDir = async (
    userId: string,
    session: SessionRecord,
  ): Promise<string> =>
    resolveBaseSessionCwd({ getProjectWorkingDir: resolveProjectWorkingDir }, userId, session)

  /**
   * A scope's skills outside any chat, as the kit lists them in a session of its folder (`/` for
   * no project, so only the person's folders are read), with the plugins the main agent has.
   */
  const scopeSkillsOf = async (userId: string, projectId: string | null): Promise<ScopeSkills> => {
    const cwd = await resolveProjectWorkingDir(userId, projectId)
    const catalog = await buildPluginCatalog({
      repo: pluginRepo,
      availability: await availabilityFor(userId, DEFAULT_AGENT_ID),
      userId,
      projectId: projectId ?? '',
      cwd,
      homeDir: userHome(),
    })
    return scopeSkills(pluginHost, {
      cwd: cwd ?? '/',
      homeDir: userHome(),
      plugins: kitPluginsOf(catalog),
    })
  }

  /** The workflows the session's `Workflow` tool runs, which a person types as commands. */
  const enabledWorkflows = async (userId: string, session: SessionRecord) => {
    const [cwd, availability] = await Promise.all([
      resolveSessionWorkingDir(userId, session),
      availabilityFor(userId, agentOf(session)),
    ])
    return listEnabledPluginWorkflows({
      repo: pluginRepo,
      availability,
      userId,
      projectId: session.projectId ?? '',
      cwd,
      homeDir: userHome(),
    })
  }

  const buildSessionPluginCatalog = async (
    userId: string,
    session: SessionRecord,
  ): Promise<PluginCatalog> => {
    const projectId = session.projectId ?? ''
    const [cwd, availability] = await Promise.all([
      resolveSessionWorkingDir(userId, session),
      availabilityFor(userId, agentOf(session)),
    ])
    return buildPluginCatalog({
      repo: pluginRepo,
      availability,
      userId,
      projectId,
      cwd,
      homeDir: userHome(),
    })
  }

  /**
   * The MCP servers the enabled plugins bundle for this session, as a run connects them: what
   * `/mcp` lists and reconnects.
   */
  const loadSessionPluginMcpServers = async (
    userId: string,
    session: SessionRecord,
  ): Promise<McpServerRecord[]> => {
    const [cwd, availability] = await Promise.all([
      resolveSessionWorkingDir(userId, session),
      availabilityFor(userId, agentOf(session)),
    ])
    const loaded = await loadEnabledPlugins({
      repo: pluginRepo,
      availability,
      userId,
      projectId: session.projectId ?? '',
      cwd,
      homeDir: userHome(),
      pluginHost,
      logger,
    })
    return loaded.mcpServers
  }

  /**
   * The chat's kit session with the facts its next run opens it with (`cc-hooks-build.ts`): its
   * folder, Claude Code's settings there, the catalog's plugins and the chat's mode. A typed
   * `/skill` expands in it, so the skill's hooks and `once` keys carry into the run.
   */
  const chatPluginSession = async (
    userId: string,
    session: SessionRecord,
  ): Promise<KitSession | undefined> => {
    if (!pluginSessions) return undefined
    const [cwd, catalog] = await Promise.all([
      resolveSessionWorkingDir(userId, session),
      buildSessionPluginCatalog(userId, session),
    ])
    return openChatPluginSession(
      pluginSessions,
      {
        chatId: session.id,
        rootChatId: session.rootSessionId,
        cwd,
        settings: readClaudeSettingsSync({ homeDir: claudeCodeHome(), cwd }),
        plugins: kitPluginsOf(catalog),
      },
      ccTranscriptPath(session),
      session.permissionMode,
    )
  }

  /** The chat's skills and commands as its kit session lists them, its folders read again first. */
  const gatherSessionSkills = async (
    userId: string,
    session: SessionRecord,
  ): Promise<readonly SessionSkill[]> => {
    const kit = await chatPluginSession(userId, session)
    if (!kit) return []
    await kit.reloadSkills({ signal: AbortSignal.timeout(60_000) })
    return sessionSkills(kit)
  }

  return {
    chatPluginSession,
    scopeSkillsOf,
    resolveProjectWorkingDir,
    resolveSessionWorkingDir,
    gatherSessionSkills,
    enabledWorkflows,
    buildSessionPluginCatalog,
    loadSessionPluginMcpServers,
  }
}
