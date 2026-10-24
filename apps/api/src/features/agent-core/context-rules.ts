import { promises as fs, type Dirent } from 'node:fs'
import { join, relative } from 'node:path'
import { parseMarkdownFrontmatter } from './skill-frontmatter'
import { parseYamlFrontmatterBlock } from './frontmatter-yaml'

/**
 * MODULAR RULE FILES — `.localix/rules/**\/*.md` and Claude Code's `.claude/rules/**\/*.md`,
 * alongside the owning context document. A path-scoped rule's globs are relative to the folder
 * that holds its `.localix`/`.claude` directory (`projectRoot` here).
 *
 * This module owns what a RULE FILE IS, and nothing else: its optional YAML
 * frontmatter, the `paths:` globs that scope a rule to part of a project, and the
 * order rules load in. The caller (`context-files.ts`) owns reading, import
 * expansion, capping and budgeting — it asks this module WHICH rules apply and gets
 * back their bodies, never their grammar.
 */

/** A rule file that applies to this project: its path and its frontmatter-stripped body. */
export interface DiscoveredRule {
  path: string
  body: string
}

/** Reads a file, capped, or null when it is absent/unreadable/empty. Injected by the caller. */
export type ReadRuleFile = (path: string) => Promise<string | null>

/**
 * Split leading YAML frontmatter off a rule file; returns the `paths:` globs + body.
 *
 * Both halves come from the frontmatter owners this directory already has, rather
 * than a fifth hand-rolled `---` scanner: `parseMarkdownFrontmatter` knows where the
 * block ends (and normalizes a BOM / CRLF, which a rule file written on Windows
 * needs and a hand-rolled `startsWith('---')` silently fails on), and
 * `parseYamlFrontmatterBlock` reads the fields with a REAL yaml parse — so every
 * shape of a YAML list (`[a, b]`, indented `- a`, flush `- a`, quoted) is understood
 * by the parser instead of by our regexes. Only the `paths` FIELD's meaning — a list
 * of globs, absent/unreadable = "applies everywhere" — is this module's own.
 */
function parseRuleFrontmatter(content: string): { paths: string[]; body: string } {
  const { body } = parseMarkdownFrontmatter(content)
  const fields = parseYamlFrontmatterBlock(content)
  return { paths: toGlobList(fields?.paths), body }
}

/** The `paths:` value as a glob list. Anything unparseable → none → the rule applies everywhere. */
function toGlobList(value: unknown): string[] {
  // A YAML list, or a comma-separated string (memory.md, "Rule frontmatter reference").
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return items
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
}

/**
 * A path-scoped rule is included when at least one of its globs matches a file
 * under the project. Localix injects context per-SESSION (not per-file), so a
 * rule that targets any file present in the project tree is loaded unconditionally.
 */
async function ruleMatchesProject(paths: string[], projectRoot: string): Promise<boolean> {
  if (paths.length === 0) return true
  for (const pattern of paths) {
    try {
      const glob = new Bun.Glob(pattern)
      for await (const _hit of glob.scan({ cwd: projectRoot, onlyFiles: true, dot: false })) {
        return true
      }
    } catch {
      // Bad pattern — degrade to including the rule rather than dropping it.
      return true
    }
  }
  return false
}

/** List `*.md` files under a `.localix/rules/` dir, recursively, alphabetically. */
async function listRuleFiles(rulesDir: string): Promise<string[]> {
  const found: string[] = []
  // Symlinked rule files and folders are followed (a shared rule set linked into a project);
  // a folder already seen by its real path is not walked again, so a link cycle ends.
  const seen = new Set<string>()
  async function kindOf(full: string, e: Dirent): Promise<'dir' | 'file' | null> {
    if (e.isDirectory()) return 'dir'
    if (e.isFile()) return 'file'
    if (!e.isSymbolicLink()) return null
    const st = await fs.stat(full).catch(() => null)
    return st?.isDirectory() ? 'dir' : st?.isFile() ? 'file' : null
  }
  async function walk(dir: string): Promise<void> {
    const real = await fs.realpath(dir).catch(() => null)
    if (!real || seen.has(real)) return
    seen.add(real)
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    const childDirs: string[] = []
    for (const e of entries) {
      const full = join(dir, e.name)
      const kind = await kindOf(full, e)
      if (kind === 'dir') childDirs.push(full)
      else if (kind === 'file' && e.name.endsWith('.md')) found.push(full)
    }
    await Promise.all(childDirs.map(walk))
  }
  await walk(rulesDir)
  return found.sort((a, b) => relative(rulesDir, a).localeCompare(relative(rulesDir, b)))
}

async function dirExists(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory()
  } catch {
    return false
  }
}

/**
 * The rules under `rulesDir` that apply to `projectRoot`, in load order, with their
 * frontmatter stripped. A missing directory yields none; a rule whose `paths:` globs
 * match nothing in the project is skipped.
 */
export async function discoverRules(
  rulesDir: string,
  projectRoot: string,
  readRuleFile: ReadRuleFile,
): Promise<DiscoveredRule[]> {
  if (!(await dirExists(rulesDir))) return []
  const discovered = await Promise.all(
    (await listRuleFiles(rulesDir)).map(async (file): Promise<DiscoveredRule | null> => {
      const raw = await readRuleFile(file)
      if (!raw) return null
      const { paths, body } = parseRuleFrontmatter(raw)
      if (!(await ruleMatchesProject(paths, projectRoot))) return null
      return { path: file, body }
    }),
  )
  return discovered.filter((rule): rule is DiscoveredRule => rule !== null)
}
