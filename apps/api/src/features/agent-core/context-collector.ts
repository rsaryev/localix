import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isPathWithin } from '../../lib/path-containment'
import { stripHtmlBlockComments } from './context-comments'
import { expandImports } from './context-imports'
import { readCappedFile } from './context-read'
import { discoverRules, type RuleScope } from './context-rules'

/**
 * The accumulator and the per-directory reads that both the session-stable discovery
 * (`context-files.ts`) and the on-demand one (`context-on-demand.ts`) are made of.
 */
export interface ContextFile {
  /** Absolute path to the discovered file. */
  path: string
  /** File content, capped + import-expanded (with a truncation marker when clipped). */
  content: string
}

export const MAX_CHARS_PER_FILE = 20_000
export const MAX_CONTEXT_FILES = 16
export const MAX_RULE_FILES = 20
export const TOTAL_CONTEXT_BUDGET = 60_000

/** Per directory, in load order: Claude Code's instruction files, then the AGENTS.md contract. */
const INSTRUCTION_FILES = [
  'CLAUDE.md',
  '.claude/CLAUDE.md',
  'CLAUDE.local.md',
  'AGENTS.md',
] as const

const TRUNCATION_MARKER = '\n[... truncated: file exceeds the 20,000 character context budget]'
const BUDGET_MARKER = '\n[... truncated: total project-context budget exhausted]'

export interface DiscoverContextEnv {
  /** Override for the user's home directory (test seam). Defaults to os.homedir(). */
  homeDir?: string
}

/** Read a single named file, capped to {@link MAX_CHARS_PER_FILE}. */
const readNamed = (path: string): Promise<string | null> =>
  readCappedFile(path, { maxChars: MAX_CHARS_PER_FILE, truncationMarker: TRUNCATION_MARKER })

const realPathOf = (path: string): Promise<string | undefined> =>
  fs.realpath(path).then(
    (real) => real,
    () => undefined,
  )

export async function isGitRoot(dir: string): Promise<boolean> {
  try {
    await fs.stat(join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

/** Accumulator enforcing count caps, a total char budget, and content dedupe. */
export class ContextCollector {
  readonly out: ContextFile[] = []
  private readonly seenPaths = new Set<string>()
  /** Files an earlier file's `@import` already inlined: not read a second time on their own. */
  private readonly imported = new Set<string>()
  private seenContent = new Set<string>()
  private contextCount = 0
  private ruleCount = 0
  private totalChars = 0
  private budgetHit = false
  private readonly env: DiscoverContextEnv | undefined

  constructor(env: DiscoverContextEnv | undefined, alreadyLoaded: readonly string[] = []) {
    this.env = env
    for (const path of alreadyLoaded) this.seenPaths.add(resolve(path))
  }

  private capReached(kind: 'context' | 'rule'): boolean {
    if (this.budgetHit) return true
    return kind === 'context'
      ? this.contextCount >= MAX_CONTEXT_FILES
      : this.ruleCount >= MAX_RULE_FILES
  }

  /**
   * Read, import-expand, dedupe, budget, and push a file. Returns true if added. A project file
   * (`confineTo`, the project root) must really lie inside the project, symlinks followed, and
   * its imports stay there too.
   */
  async add(
    path: string,
    kind: 'context' | 'rule',
    rawOverride?: string,
    confineTo?: string,
  ): Promise<boolean> {
    if (this.capReached(kind)) return false
    const abs = resolve(path)
    if (this.seenPaths.has(abs) || this.imported.has(abs)) return false
    const root = confineTo ? await realPathOf(confineTo) : undefined
    if (confineTo && (!root || !isPathWithin(root, (await realPathOf(abs)) ?? ''))) return false
    const raw = rawOverride ?? (await readNamed(abs))
    if (!raw) return false
    const expanded = await expandImports(stripHtmlBlockComments(raw), dirname(abs), {
      homeDir: this.env?.homeDir,
      imported: this.imported,
      ...(root ? { confineTo: root } : {}),
    })
    const content = expanded.trim()
    if (!content) return false
    if (this.seenContent.has(content)) {
      this.seenPaths.add(abs)
      return false
    }

    const remaining = TOTAL_CONTEXT_BUDGET - this.totalChars
    let finalContent = content
    if (content.length > remaining) {
      finalContent = content.slice(0, Math.max(0, remaining)) + BUDGET_MARKER
      this.budgetHit = true
    }

    this.seenPaths.add(abs)
    this.seenContent.add(content)
    this.totalChars += finalContent.length
    if (kind === 'context') this.contextCount++
    else this.ruleCount++
    this.out.push({ path: abs, content: finalContent })
    return true
  }
}

/** Load rules from `rulesDir` (`.claude/rules`, `.localix/rules`): which apply is `context-rules.ts`'s. */
export async function collectRules(
  rulesDir: string,
  base: string,
  collector: ContextCollector,
  confineTo?: string,
  scope?: RuleScope,
): Promise<void> {
  for (const rule of await discoverRules(rulesDir, base, readNamed, scope)) {
    await collector.add(rule.path, 'rule', rule.body, confineTo)
  }
}

/**
 * Emit one directory's instruction files, then (inside the project) its Localix context document
 * and the rules of its `.claude/` and `.localix/`. `confineTo` is where its files must really lie:
 * the project for a directory in it, the directory itself above it. A checkout must not use a
 * symlink to pull instructions from an unrelated directory into the prompt.
 */
export async function collectDir(
  dir: string,
  confineTo: string,
  collector: ContextCollector,
  inProject: boolean,
  scope?: RuleScope,
): Promise<void> {
  for (const name of INSTRUCTION_FILES) {
    await collector.add(join(dir, name), 'context', undefined, confineTo)
  }
  // Rules are the project's own: an ancestor above it contributes only its instruction files.
  if (!inProject) return
  await collectRules(join(dir, '.claude', 'rules'), dir, collector, confineTo, scope)
  const localixDir = join(dir, '.localix')
  await collector.add(join(localixDir, 'context.md'), 'context', undefined, confineTo)
  await collectRules(join(localixDir, 'rules'), dir, collector, confineTo, scope)
}
