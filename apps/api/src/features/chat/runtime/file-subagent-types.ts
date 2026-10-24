import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { isPathWithin } from '../../../lib/path-containment'
import { parseMarkdownFrontmatter, scalarField } from '../../agent-core/skill-discovery'
import { parseAgentFile } from '../../plugins/discovery-cc-files'
import { buildLoadedAgent, type LoadedPluginAgent } from '../../plugins/loader-contract'

/**
 * Claude Code's agent files outside a plugin as `delegate` subagent types (sub-agents.md, "Choose
 * the subagent scope"): a project's `.claude/agents/` in the working directory and each parent up
 * to the repository root — the closest definition of a name winning — then the user's
 * `~/.claude/agents/`. Both are scanned recursively and a subfolder does not change identity: the
 * `name` frontmatter does. A file without a `name` or a `description` is documentation, skipped.
 *
 * A type is named bare (`reviewer`), as Claude Code names it, and runs like a plugin agent: its
 * body is the child's instructions, its `tools`/`disallowedTools`/`model`/`effort`/`skills`/
 * `maxTurns`/`background`/`isolation` apply. Project links must stay inside their folder.
 */
const MAX_DEPTH = 6
const MAX_FILES = 500

async function markdownFiles(root: string, confine: boolean): Promise<string[]> {
  const real = await fs.realpath(root).catch(() => null)
  if (!real) return []
  const out: string[] = []
  const seen = new Set<string>()
  async function walk(dir: string, depth: number): Promise<void> {
    const at = await fs.realpath(dir).catch(() => null)
    if (!at || seen.has(at) || depth > MAX_DEPTH || out.length >= MAX_FILES) return
    if (confine && !isPathWithin(real!, at)) return
    seen.add(at)
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      const st = entry.isSymbolicLink() ? await fs.stat(full).catch(() => null) : entry
      if (st?.isDirectory()) await walk(full, depth + 1)
      else if (st?.isFile() && /\.md$/i.test(entry.name)) {
        const file = await fs.realpath(full).catch(() => null)
        if (file && (!confine || isPathWithin(real!, file))) out.push(full)
      }
    }
  }
  await walk(root, 0)
  return out
}

async function readAgents(dir: string, scope: 'project' | 'user'): Promise<LoadedPluginAgent[]> {
  const out: LoadedPluginAgent[] = []
  for (const file of await markdownFiles(dir, scope === 'project')) {
    const raw = await fs.readFile(file, 'utf8').catch(() => '')
    const { fields } = parseMarkdownFrontmatter(raw)
    const name = scalarField(fields.name)?.trim()
    if (!name || !scalarField(fields.description)?.trim() || name.startsWith('-')) continue
    if (name.includes(':') || name.length > 256) continue
    const parsed = await parseAgentFile(file, name)
    if (!parsed) continue
    const loaded = buildLoadedAgent(scope, { ...parsed, name }, (text) => text)
    out.push({ ...loaded, fullName: name })
  }
  return out
}

async function isGitRoot(dir: string): Promise<boolean> {
  return fs.stat(join(dir, '.git')).then(
    () => true,
    () => false,
  )
}

/** The working directory's agent files, then the user's; the first definition of a name wins. */
export async function loadFileSubagentTypes(
  cwd: string | null | undefined,
  home: string = homedir(),
): Promise<LoadedPluginAgent[]> {
  const dirs: Array<[string, 'project' | 'user']> = []
  if (cwd && cwd !== '/') {
    // Up to the repository root; outside a repository, the working directory alone.
    const chain: string[] = []
    let found = false
    let cur = resolve(cwd)
    while (cur !== home) {
      chain.push(cur)
      if (await isGitRoot(cur)) {
        found = true
        break
      }
      const parent = dirname(cur)
      if (parent === cur) break
      cur = parent
    }
    if (!found) chain.splice(1)
    for (const dir of chain) dirs.push([join(dir, '.claude', 'agents'), 'project'])
  }
  dirs.push([join(home, '.claude', 'agents'), 'user'])
  const byName = new Map<string, LoadedPluginAgent>()
  for (const [dir, scope] of dirs) {
    for (const agent of await readAgents(dir, scope)) {
      if (!byName.has(agent.name)) byName.set(agent.name, agent)
    }
  }
  return [...byName.values()]
}
