import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { discoverFilesystemSkills } from '../../agent-core/skill-discovery'
import { buildPluginCatalog, type PluginCatalog } from '../../plugins/catalog'
import { loadEnabledPlugins } from '../../plugins/loader'
import type { McpServerRecord } from '../../mcp/repository'
import type { PluginCommand } from '../../plugins/contracts'
import { folderWorkflowCommands } from '../../plugins/workflow-commands'
import { catalogPluginCommands, readCatalogPluginSkills } from '../../plugins/plugin-skills'
import type { createProjectsRepository } from '../../projects/repository'
import type { SessionRecord } from '../repository'
import { projectWorkingDirPort, resolveBaseSessionCwd } from '../session-cwd'
import { userHome } from '../../../lib/env'
import { toFileSkillRecord, toPluginSkillRecord, type SkillRecord } from './skills'
import type { SkillDiscoveryLogger } from '../../agent-core/skill-discovery'
import type { AvailabilityReader } from '../../capabilities/availability'
import type { CapabilitySourceRepository } from '../../capabilities/source-repository'

export interface SessionWorkspaceDeps {
  projectsRepo: ReturnType<typeof createProjectsRepository>
  pluginRepo: CapabilitySourceRepository
  /**
   * What an AGENT's rules say about its plugins. A PORT because this module owns no
   * storage — the same reason the repositories above are injected — and because the
   * composition root is the only place that can bind the rule store.
   */
  availabilityFor: (userId: string, agentId: string) => Promise<AvailabilityReader>
  logger?: SkillDiscoveryLogger
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
  const { projectsRepo, pluginRepo, availabilityFor, logger } = deps

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

  const gatherSessionSkills = async (
    userId: string,
    session: SessionRecord,
  ): Promise<SkillRecord[]> => {
    const workingDir = await resolveProjectWorkingDir(userId, session.projectId)
    const fileSkills = await discoverFilesystemSkills(workingDir, undefined, logger)
    return fileSkills.map((f) => toFileSkillRecord(f, session.projectId ?? ''))
  }

  /**
   * Slash-commands declared by every ENABLED plugin visible to a session, flattened
   * with their owning plugin name. Mirrors the enable rule the loader/service use:
   * a DB row wins; absent one, bundled command-only plugins are on by default.
   */
  const gatherEnabledPluginCommands = async (
    userId: string,
    session: SessionRecord,
  ): Promise<
    Array<{ plugin: string; command: PluginCommand; pluginDir: string; dataDir?: string }>
  > => {
    const projectId = session.projectId ?? ''
    const [cwd, availability] = await Promise.all([
      resolveSessionWorkingDir(userId, session),
      availabilityFor(userId, agentOf(session)),
    ])
    const catalog = await buildPluginCatalog({
      repo: pluginRepo,
      availability,
      userId,
      projectId,
      cwd,
      homeDir: userHome(),
    })
    // Each command's text takes the plugin's saved `${user_config.KEY}` values, as a skill's does.
    return [
      ...catalogPluginCommands(catalog, { projectDir: cwd, homeDir: userHome() }),
      // Saved workflows (`.claude/workflows`, `~/.claude/workflows`) run as `/<name>`.
      ...(await folderWorkflowCommands({ cwd, homeDir: userHome() })),
    ]
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
      logger,
    })
    return loaded.mcpServers
  }

  /**
   * The `SKILL.md` skills of every ENABLED plugin, named as Claude Code types them:
   * `/<plugin>:<skill>`. Read with the loader's substitution, so the slash command runs the text
   * the model would load; skill overrides do not apply to them, as in Claude Code.
   */
  const gatherEnabledPluginSkills = async (
    userId: string,
    session: SessionRecord,
  ): Promise<SkillRecord[]> => {
    const projectId = session.projectId ?? ''
    const [catalog, projectDir] = await Promise.all([
      buildSessionPluginCatalog(userId, session),
      resolveSessionWorkingDir(userId, session),
    ])
    const skills = await readCatalogPluginSkills(catalog, {
      projectId,
      projectDir,
      homeDir: userHome(),
      logger,
    })
    return skills.map((skill) => toPluginSkillRecord(skill, projectId))
  }

  return {
    resolveProjectWorkingDir,
    resolveSessionWorkingDir,
    gatherSessionSkills,
    gatherEnabledPluginCommands,
    gatherEnabledPluginSkills,
    buildSessionPluginCatalog,
    loadSessionPluginMcpServers,
  }
}
