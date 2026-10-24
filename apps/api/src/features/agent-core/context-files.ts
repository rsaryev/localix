import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, parse, resolve } from 'node:path'
import { isPathWithin } from '../../lib/path-containment'

import { readCappedFile } from './context-read'
import { expandImports } from './context-imports'
import { stripHtmlBlockComments } from './context-comments'
import { discoverRules } from './context-rules'

/**
 * Localix context files. A context document lives at
 * `<base>/.localix/context.md`; optional modular rules live below
 * `<base>/.localix/rules/`. We discover them once per run and inject them as a
 * session-stable "# Project context" system-prompt section.
 *
 * Discovery is Localix-owned:
 * - user-global `~/.localix/context.md` + `~/.localix/rules/*.md` load first;
 * - the directory hierarchy is walked and emitted ROOT-first (broadest → nearest);
 * - `.localix/rules/` markdown files contribute modular rules (optional `paths:` frontmatter
 *   scopes a rule to a project subtree);
 * - `@path` imports are expanded inline (see {@link expandImports}).
 *
 * Claude Code's instruction files load on the same root-to-cwd path, as Claude Code reads them
 * (memory.md): `~/.claude/CLAUDE.md` and `~/.claude/rules/` with the user's own, and in each
 * directory `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, then `AGENTS.md` (its
 * `claude-md-and-agents-md` mode; one a CLAUDE.md already imports is not read twice) and
 * `.claude/rules/`. Directories above the repository contribute their instruction files too.
 * Block-level HTML comments are stripped. Other tools' homes (`.cursorrules`) are not scanned.
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

async function isGitRoot(dir: string): Promise<boolean> {
  try {
    await fs.stat(join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

/** Accumulator enforcing count caps, a total char budget, and content dedupe. */
class ContextCollector {
  readonly out: ContextFile[] = []
  private seenPaths = new Set<string>()
  /** Files an earlier file's `@import` already inlined: not read a second time on their own. */
  private readonly imported = new Set<string>()
  private seenContent = new Set<string>()
  private contextCount = 0
  private ruleCount = 0
  private totalChars = 0
  private budgetHit = false
  private readonly env: DiscoverContextEnv | undefined

  constructor(env: DiscoverContextEnv | undefined) {
    this.env = env
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

/** Load `.localix/rules/**\/*.md` from `rulesDir`. Which rules APPLY (and what their
 *  frontmatter means) is `context-rules.ts`'s knowledge; budgeting them is ours. */
async function collectRules(
  rulesDir: string,
  projectRoot: string,
  collector: ContextCollector,
  confineTo?: string,
): Promise<void> {
  for (const rule of await discoverRules(rulesDir, projectRoot, readNamed)) {
    await collector.add(rule.path, 'rule', rule.body, confineTo)
  }
}

/**
 * Emit one directory's instruction files, then (inside the project) its Localix context document
 * and the rules of its `.claude/` and `.localix/`. `confineTo` is where its files must really lie:
 * the project for a directory in it, the directory itself above it. A checkout must not use a
 * symlink to pull instructions from an unrelated directory into the prompt.
 */
async function collectDir(
  dir: string,
  confineTo: string,
  collector: ContextCollector,
  inProject: boolean,
): Promise<void> {
  for (const name of INSTRUCTION_FILES) {
    await collector.add(join(dir, name), 'context', undefined, confineTo)
  }
  // Rules are the project's own: an ancestor above it contributes only its instruction files.
  if (!inProject) return
  await collectRules(join(dir, '.claude', 'rules'), dir, collector, confineTo)
  const localixDir = join(dir, '.localix')
  await collector.add(join(localixDir, 'context.md'), 'context', undefined, confineTo)
  await collectRules(join(localixDir, 'rules'), dir, collector, confineTo)
}

/**
 * Discovers Localix context files visible from `cwd`.
 *
 * Load order (broadest → nearest):
 * 1. user-global `~/.localix/context.md`, then `~/.localix/rules/**\/*.md`;
 * 2. the directory hierarchy from the git root DOWN to `cwd` (root-first), each
 *    level contributing `AGENTS.md` (else `CLAUDE.md`), `.localix/context.md` and
 *    `.localix/rules/**\/*.md`.
 *
 * `@path` imports are expanded inline. Caps: {@link MAX_CHARS_PER_FILE} per file,
 * {@link MAX_CONTEXT_FILES} context files, {@link MAX_RULE_FILES} rules, and a
 * {@link TOTAL_CONTEXT_BUDGET} total-character budget. Async, never throws.
 */
export async function discoverContextFiles(
  cwd?: string | null,
  env?: DiscoverContextEnv,
): Promise<ContextFile[]> {
  try {
    if (!cwd || cwd === '/') return []
    const start = resolve(cwd)
    const home = env?.homeDir ?? homedir()
    const fsRoot = parse(start).root
    const collector = new ContextCollector(env)

    // The directory chain from cwd to the filesystem root. The part up to (and including) the git
    // root is the project; Claude Code reads the instruction files above it as well.
    const chain: string[] = []
    let projectDepth = -1
    let cur: string | null = start
    while (cur) {
      chain.push(cur)
      if (projectDepth < 0 && (await isGitRoot(cur))) projectDepth = chain.length
      if (cur === fsRoot) break
      const parent: string = dirname(cur)
      cur = parent === cur ? null : parent
    }
    const inProject = chain.slice(0, projectDepth < 0 ? 1 : projectDepth)
    const projectRoot = inProject[inProject.length - 1] ?? start

    // Phase 1 — the user's own instructions: Localix's, then Claude Code's. User-level rules
    // scope their globs against the session's working directory.
    const localixHome = join(home, '.localix')
    await collector.add(join(localixHome, 'context.md'), 'context')
    await collectRules(join(localixHome, 'rules'), start, collector)
    const claudeHome = join(home, '.claude')
    await collector.add(join(claudeHome, 'CLAUDE.md'), 'context')
    await collectRules(join(claudeHome, 'rules'), start, collector)

    // Phase 2 — directory hierarchy, ROOT-first. A file already loaded above is not read again.
    for (const dir of [...chain].reverse()) {
      const within = inProject.includes(dir)
      await collectDir(dir, within ? projectRoot : dir, collector, within)
    }

    return collector.out
  } catch {
    return []
  }
}

/**
 * Renders the "# Project context" system-prompt section, or null when no
 * context files were discovered. Session-stable — placed right after
 * "# Workspace" (the order is the prompt catalog's, `prompt/catalog.ts`).
 * The preamble labels the block as project-provided so model instructions
 * from repo files never masquerade as user input (prompt-injection hygiene).
 */
export function buildProjectContextSection(
  files: readonly ContextFile[] | undefined,
): string | null {
  if (!files || files.length === 0) return null
  return [
    '# Project context',
    'Project-provided instructions (from files in the workspace). Follow them; if they conflict with user instructions, the user wins.',
    'Directory-specific instructions apply within that directory. Read any deeper CLAUDE.md or AGENTS.md before editing there. Later, nearer instructions take precedence within their scope.',
    '',
    ...files.map((f) => `## ${f.path}\n${f.content}`),
  ].join('\n')
}
