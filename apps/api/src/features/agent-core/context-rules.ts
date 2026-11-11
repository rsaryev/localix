import { promises as fs, type Dirent } from 'node:fs'
import { join, relative } from 'node:path'
import type { MemoryRule, MemoryRuleScope } from '@rsaryev/llx-plugin/format'

/**
 * MODULAR RULE FILES — `.localix/rules/**\/*.md` and Claude Code's `.claude/rules/**\/*.md`,
 * alongside the owning context document. A path-scoped rule's globs are relative to the folder
 * that holds its `.localix`/`.claude` directory (`projectRoot` here).
 *
 * This module lists the rule files and the order they load in; what a file means (its
 * `paths:` frontmatter, which touched file activates it) is the kit's, through the
 * installed {@link MemoryRuleReader}. The caller (`context-files.ts`) owns reading, import
 * expansion, capping and budgeting — it asks this module WHICH rules apply and gets
 * back their bodies, never their grammar.
 */

/**
 * Which rules a read takes. A rule without `paths` applies everywhere and loads with the session
 * (`unscoped`); a path-scoped one loads once a file it matches has been worked with (`touched`,
 * absolute paths), as Claude Code loads it "when Claude uses the Read, Write, or Edit tool on a
 * matching file". The session-stable read takes the unscoped rules only.
 */
export interface RuleScope {
  unscoped: boolean
  touched: readonly string[]
}

const SESSION_STABLE: RuleScope = { unscoped: true, touched: [] }

/** A rule file that applies to this project: its path and its frontmatter-stripped body. */
export interface DiscoveredRule {
  path: string
  body: string
}

/** Reads a file, capped, or null when it is absent/unreadable/empty. Injected by the caller. */
export type ReadRuleFile = (path: string) => Promise<string | null>

/**
 * What a rule file means, as Claude Code reads it (memory.md, "Path-specific rules"), through the
 * plugin kit (`plugins/kit`), installed here at boot (A4: the composition root wires it), so
 * agent-core never imports the kit: its `paths` frontmatter and body, and whether a touched file
 * activates it, relative to the folder holding its `.claude` or, for a user rule, `cwd`. Until a
 * reader is installed no rule loads.
 */
export interface MemoryRuleReader {
  read(path: string, text: string, scope: MemoryRuleScope): MemoryRule
  activatesFor(rule: MemoryRule, file: string, cwd: string): boolean
}

let installed: MemoryRuleReader | undefined

/** Install (or, with `undefined`, remove) the host's reader. One per process, set at boot. */
export function installMemoryRuleReader(reader: MemoryRuleReader | undefined): void {
  installed = reader
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
 * The rules under `rulesDir` that apply, in load order, with their frontmatter stripped: `scope`
 * says whose rules they are, `cwd` the working directory a user rule's patterns are relative to
 * (and a rule outside a `.claude` folder's). A missing directory yields none; a path-scoped rule
 * loads once a file it matches is touched.
 */
export async function discoverRules(
  rulesDir: string,
  owner: { scope: MemoryRuleScope; cwd: string },
  readRuleFile: ReadRuleFile,
  scope: RuleScope = SESSION_STABLE,
): Promise<DiscoveredRule[]> {
  const reader = installed
  if (!reader || !(await dirExists(rulesDir))) return []
  const discovered = await Promise.all(
    (await listRuleFiles(rulesDir)).map(async (file): Promise<DiscoveredRule | null> => {
      const raw = await readRuleFile(file)
      if (!raw) return null
      const rule = reader.read(file, raw, owner.scope)
      const applies =
        rule.paths.length === 0
          ? scope.unscoped
          : scope.touched.some((touched) => reader.activatesFor(rule, touched, owner.cwd))
      return applies ? { path: file, body: rule.body } : null
    }),
  )
  return discovered.filter((rule): rule is DiscoveredRule => rule !== null)
}
