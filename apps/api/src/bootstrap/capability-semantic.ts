/**
 * The capability catalogs in the semantic index, assembled: each feature provides its own source
 * (`<feature>/semantic.ts`) and the capability feature announces their changes on the feed.
 * Listed for the workspace owner, across the owner's projects.
 */
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../db/types'
import { createAgentsSemanticSource } from '../features/agents/semantic'
import type { AgentsService } from '../features/agents/service'
import { announceCapabilityChanges } from '../features/capabilities/changes'
import type { SemanticService } from '../features/embeddings/service'
import { createMcpSemanticSource } from '../features/mcp/semantic'
import type { McpService } from '../features/mcp/service'
import { createPluginsSemanticSource } from '../features/plugins/semantic'
import type { PluginService } from '../features/plugins/service-types'
import type { createProjectsService } from '../features/projects/service'
import { createSkillsSemanticSource } from '../features/skills-curator/semantic'
import type { SkillsCuratorService } from '../features/skills-curator/service'

export function registerCapabilitySemantics(deps: {
  db: Kysely<AppDatabase>
  owner: string
  semantic: Pick<SemanticService, 'registerSource'>
  projects: Pick<ReturnType<typeof createProjectsService>, 'listProjects'>
  skills: Pick<SkillsCuratorService, 'listSkills'>
  plugins: Pick<PluginService, 'listPlugins'>
  mcp: Pick<McpService, 'listServers'>
  agents: Pick<AgentsService, 'listAgents'>
}): () => void {
  const { owner } = deps
  const projects = async () =>
    (await deps.projects.listProjects(owner)).projects.map((project) => project.id)
  for (const source of [
    createSkillsSemanticSource({
      owner,
      projects,
      listSkills: (...a) => deps.skills.listSkills(...a),
    }),
    createPluginsSemanticSource({
      owner,
      projects,
      listPlugins: (...a) => deps.plugins.listPlugins(...a),
    }),
    createMcpSemanticSource({ owner, projects, listServers: (...a) => deps.mcp.listServers(...a) }),
    createAgentsSemanticSource({
      owner,
      projects,
      listAgents: (...a) => deps.agents.listAgents(...a),
    }),
  ]) {
    deps.semantic.registerSource(source)
  }
  return announceCapabilityChanges(deps.db)
}
