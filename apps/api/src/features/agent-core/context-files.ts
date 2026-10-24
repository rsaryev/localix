import { homedir } from 'node:os'
import { dirname, join, parse, resolve } from 'node:path'

import {
  collectDir,
  collectRules,
  ContextCollector,
  isGitRoot,
  type ContextFile,
  type DiscoverContextEnv,
} from './context-collector'

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
 * - `@path` imports are expanded inline (see `context-imports.ts`).
 *
 * Claude Code's instruction files load on the same root-to-cwd path, as Claude Code reads them
 * (memory.md): `~/.claude/CLAUDE.md` and `~/.claude/rules/` with the user's own, and in each
 * directory `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, then `AGENTS.md` (its
 * `claude-md-and-agents-md` mode; one a CLAUDE.md already imports is not read twice) and
 * `.claude/rules/`. Directories above the repository contribute their instruction files too.
 * Block-level HTML comments are stripped. Other tools' homes (`.cursorrules`) are not scanned.
 */
export type { ContextFile, DiscoverContextEnv } from './context-collector'
export {
  MAX_CHARS_PER_FILE,
  MAX_CONTEXT_FILES,
  MAX_RULE_FILES,
  TOTAL_CONTEXT_BUDGET,
} from './context-collector'

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
