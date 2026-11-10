import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { collectMarkdownFiles } from '../../plugins/discovery-cc-markdown-scan'
import { readAgentText } from '../../plugins/kit'
import { buildLoadedAgent, type LoadedPluginAgent } from '../../plugins/loader-contract'

/**
 * A Claude Code agent file as the catalog knows it (sub-agents.md). The format is Claude Code's:
 * a Markdown body under YAML frontmatter. Its `model` and `effort` are not read: the person
 * chooses those in Localix's settings.
 */
export type AgentSource = 'managed' | 'project' | 'user' | 'plugin' | 'builtin'

export interface CatalogAgent extends LoadedPluginAgent {
  source: AgentSource
  /** '' for a user, managed, plugin or built-in agent; else the project it was found for. */
  projectId: string
  /** The file; '' for a plugin or built-in agent. */
  path: string
  bodyHash: string
  permissionMode?: string
  /**
   * Frontmatter `hooks`, raw: active only while this agent runs as a subagent. Only a user's,
   * project's or managed file has them: a plugin's agent loads without (sub-agents.md).
   */
  hooks?: unknown
  /** Frontmatter `mcpServers`, raw: names of configured servers and inline definitions. */
  mcpServers?: readonly unknown[]
  /** What the type does when delegated to: runs as the delegator (`general-purpose`). */
  self?: boolean
}

export const bodyHashOf = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16)

/** One agent file, read by the kit, or null when it is documentation Claude Code would skip. */
export async function readAgentFile(
  file: string,
  source: Exclude<AgentSource, 'plugin' | 'builtin'>,
  projectId: string,
): Promise<CatalogAgent | null> {
  const read = readAgentText(await fs.readFile(file, 'utf8').catch(() => ''), file, source)
  if (!read) return null
  const { agent, permissionMode } = read
  const loaded = buildLoadedAgent(source, agent, (text) => text)
  return {
    ...loaded,
    fullName: agent.name,
    source,
    projectId,
    path: file,
    bodyHash: bodyHashOf(agent.prompt),
    ...(permissionMode ? { permissionMode } : {}),
    ...(agent.hooks !== undefined ? { hooks: agent.hooks } : {}),
    ...(Array.isArray(agent.mcpServers) && agent.mcpServers.length
      ? { mcpServers: agent.mcpServers }
      : {}),
  }
}

/** Every agent file under `<claudeDir>/agents`, recursively and confined to `claudeDir`. */
export async function scanAgentFolder(
  claudeDir: string,
  source: Exclude<AgentSource, 'plugin' | 'builtin'>,
  projectId: string,
): Promise<CatalogAgent[]> {
  const files = await collectMarkdownFiles(claudeDir, undefined, 'agents', { kind: 'agent' })
  const read = await Promise.all(files.map(({ file }) => readAgentFile(file, source, projectId)))
  return read.filter((agent): agent is CatalogAgent => agent !== null)
}
