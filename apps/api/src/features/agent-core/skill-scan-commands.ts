import { promises as fs, type Dirent } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { readSkillMarkdownFile, skillFileErrorDetail } from './skill-file'
import { parseSkillFrontmatter, type DiscoveredSkill } from './skill-frontmatter'
import { makeLazySkill } from './skill-lazy'
import {
  MAX_SKILL_ENTRIES_PER_ROOT,
  MAX_SKILL_SCAN_DEPTH,
  type SkillScanLogger,
} from './skill-scan-contracts'
import { canonicalPathWithin } from './skill-scan-tree'

/**
 * Claude Code's older command files as skills: `.claude/commands/<path>.md`, named by the path
 * with each `/` a `:` (`commands/git/commit.md` → `/git:commit`). A command takes a skill's
 * frontmatter except `name` and `paths` (skills.md, "Choose where skills load"), so both are
 * dropped; with no `description` the first body line is it, as for a skill. Hidden folders, and
 * names a command cannot be typed by, are skipped; links stay inside `safetyRoot` when one is set.
 */
const COMMAND_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*(?::[A-Za-z0-9][A-Za-z0-9_.-]*)*$/

export async function readCommandFilesAsSkills(
  container: string,
  scope: 'project' | 'global',
  logger: SkillScanLogger,
  safetyRoot: string | null,
): Promise<DiscoveredSkill[]> {
  const files: string[] = []
  let entries = 0
  const seen = new Set<string>()
  async function walk(dir: string, depth: number): Promise<void> {
    const real = await canonicalPathWithin(dir, safetyRoot, logger)
    if (!real || seen.has(real) || depth > MAX_SKILL_SCAN_DEPTH) return
    seen.add(real)
    let dirents: Dirent[]
    try {
      dirents = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      )
    } catch {
      return
    }
    for (const entry of dirents) {
      if (++entries > MAX_SKILL_ENTRIES_PER_ROOT || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      const st = entry.isSymbolicLink() ? await fs.stat(full).catch(() => null) : entry
      if (st?.isDirectory()) await walk(full, depth + 1)
      else if (st?.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(full)
    }
  }
  try {
    await fs.access(container)
  } catch {
    return []
  }
  await walk(container, 0)
  const out: DiscoveredSkill[] = []
  for (const path of files) {
    const name = relative(container, path).replace(/\.md$/i, '').split(/[\\/]/).join(':')
    const skill = await readCommandFileAsSkill(path, name, scope, logger, safetyRoot)
    if (skill) out.push(skill)
  }
  return out
}

/**
 * One command file as a skill named `name` (its path with `:`), or null when it cannot be one.
 * `transformContent` is a plugin's path and option substitution for the body.
 */
export async function readCommandFileAsSkill(
  path: string,
  name: string,
  scope: 'project' | 'global',
  logger: SkillScanLogger,
  safetyRoot: string | null,
  transformContent?: (content: string) => string,
): Promise<DiscoveredSkill | null> {
  if (!COMMAND_NAME_RE.test(name)) return null
  const readPath = await canonicalPathWithin(path, safetyRoot, logger)
  if (!readPath) return null
  try {
    const fm = parseSkillFrontmatter(await readSkillMarkdownFile(readPath))
    if (!fm.body) return null
    delete fm.name
    delete fm.activationPaths
    return makeLazySkill(fm, name, scope, path, dirname(path), readPath, transformContent)
  } catch (error) {
    logger.warn(`[skills] ignoring command "${path}": ${skillFileErrorDetail(error)}`, {
      code: 'read_failed',
      kind: 'command',
      path,
    })
    return null
  }
}
