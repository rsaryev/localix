import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, parse, resolve } from 'node:path'

import { readCappedFile } from './context-read'
import { expandImports } from './context-imports'
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
 * Foreign agent homes and instruction conventions are deliberately not scanned.
 */
export interface ContextFile {
  /** Absolute path to the discovered file. */
  path: string
  /** File content, capped + import-expanded (with a truncation marker when clipped). */
  content: string
}

export const MAX_CHARS_PER_FILE = 20_000
export const MAX_CONTEXT_FILES = 8
export const MAX_RULE_FILES = 20
export const TOTAL_CONTEXT_BUDGET = 60_000

const TRUNCATION_MARKER = '\n[... truncated: file exceeds the 20,000 character context budget]'
const BUDGET_MARKER = '\n[... truncated: total project-context budget exhausted]'

export interface DiscoverContextEnv {
  /** Override for the user's home directory (test seam). Defaults to os.homedir(). */
  homeDir?: string
}

/** Read a single named file, capped to {@link MAX_CHARS_PER_FILE}. */
const readNamed = (path: string): Promise<string | null> =>
  readCappedFile(path, { maxChars: MAX_CHARS_PER_FILE, truncationMarker: TRUNCATION_MARKER })

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

  /** Read, import-expand, dedupe, budget, and push a file. Returns true if added. */
  async add(path: string, kind: 'context' | 'rule', rawOverride?: string): Promise<boolean> {
    if (this.capReached(kind)) return false
    const abs = resolve(path)
    if (this.seenPaths.has(abs)) return false
    const raw = rawOverride ?? (await readNamed(abs))
    if (!raw) return false
    const expanded = await expandImports(raw, dirname(abs), { homeDir: this.env?.homeDir })
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
): Promise<void> {
  for (const rule of await discoverRules(rulesDir, projectRoot, readNamed)) {
    await collector.add(rule.path, 'rule', rule.body)
  }
}

/** Emit one directory's Localix context document and modular rules. */
async function collectDir(
  dir: string,
  projectRoot: string,
  collector: ContextCollector,
): Promise<void> {
  const localixDir = join(dir, '.localix')
  await collector.add(join(localixDir, 'context.md'), 'context')
  await collectRules(join(localixDir, 'rules'), projectRoot, collector)
}

/**
 * Discovers Localix context files visible from `cwd`.
 *
 * Load order (broadest → nearest):
 * 1. user-global `~/.localix/context.md`, then `~/.localix/rules/**\/*.md`;
 * 2. the directory hierarchy from the git root DOWN to `cwd` (root-first), each
 *    level contributing `.localix/context.md` and `.localix/rules/**\/*.md`.
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

    // Collect the directory chain from cwd up to (and including) the git root,
    // stopping before $HOME / the filesystem root.
    const chain: string[] = []
    let cur: string | null = start
    while (cur) {
      if (cur === home) break // a file directly in $HOME is not project context
      chain.push(cur)
      if (await isGitRoot(cur)) break
      if (cur === fsRoot) break
      const parent: string = dirname(cur)
      cur = parent === cur ? null : parent
    }
    const projectRoot = chain[chain.length - 1] ?? start

    // Phase 1 — user-global Localix instructions + rules.
    const localixHome = join(home, '.localix')
    await collector.add(join(localixHome, 'context.md'), 'context')
    await collectRules(join(localixHome, 'rules'), projectRoot, collector)

    // Phase 2 — directory hierarchy, ROOT-first.
    for (const dir of [...chain].reverse()) {
      await collectDir(dir, projectRoot, collector)
    }

    return collector.out
  } catch {
    return []
  }
}

/**
 * Renders the "# Project context" system-prompt section, or null when no
 * context files were discovered. Session-stable — placed right after
 * "# Workspace" (see the cache-order contract in system-prompt.ts).
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
    '',
    ...files.map((f) => `## ${f.path}\n${f.content}`),
  ].join('\n')
}
