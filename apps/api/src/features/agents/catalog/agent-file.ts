import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseYamlFrontmatterBlock } from '../../agent-core/frontmatter-yaml'
import { parseMarkdownFrontmatter, scalarField } from '../../agent-core/skill-discovery'
import { collectMarkdownFiles, parseAgentFile } from '../../plugins/discovery-cc-files'
import type { LocalixKey } from '../../plugins/contracts'
import { buildLoadedAgent, type LoadedPluginAgent } from '../../plugins/loader-contract'

/**
 * A Claude Code agent file as the catalog knows it (sub-agents.md). The format is Claude Code's:
 * a Markdown body under YAML frontmatter. What Claude Code has no place for lives under one
 * namespaced `localix:` key, which Claude Code ignores without an error.
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
  localix: LocalixKey
  /** What the type does when delegated to: runs as the delegator (`general-purpose`). */
  self?: boolean
  /** Another name the type answers to (`claude` for `general-purpose`). */
  aliases?: readonly string[]
}

export const bodyHashOf = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16)

/**
 * One agent file, or null when it is documentation: Claude Code needs a `name` (at most 256
 * characters, no `:`, not starting with `-`) and a `description`.
 */
export async function readAgentFile(
  file: string,
  source: Exclude<AgentSource, 'plugin' | 'builtin'>,
  projectId: string,
): Promise<CatalogAgent | null> {
  const raw = await fs.readFile(file, 'utf8').catch(() => '')
  const { fields } = parseMarkdownFrontmatter(raw)
  const name = scalarField(fields.name)?.trim()
  if (!name || !scalarField(fields.description)?.trim() || name.startsWith('-')) return null
  if (name.includes(':') || name.length > 256) return null
  // The scan name is the bare file name, so a subfolder never prefixes the identity.
  const parsed = await parseAgentFile(file, file.replace(/^.*[\\/]/, '').replace(/\.md$/i, ''))
  if (!parsed) return null
  const yaml = parseYamlFrontmatterBlock(raw)
  const loaded = buildLoadedAgent(source, { ...parsed, name }, (text) => text)
  const permissionMode = typeof yaml?.permissionMode === 'string' ? yaml.permissionMode : undefined
  return {
    ...loaded,
    fullName: name,
    source,
    projectId,
    path: file,
    bodyHash: bodyHashOf(parsed.prompt),
    localix: loaded.localix ?? { priority: 0 },
    ...(permissionMode ? { permissionMode } : {}),
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

export const agentsFolderOf = (claudeDir: string): string => join(claudeDir, 'agents')
