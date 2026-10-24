import { homedir } from 'node:os'
import { dirname, join, parse, relative, resolve, sep } from 'node:path'
import {
  collectDir,
  collectRules,
  ContextCollector,
  isGitRoot,
  type ContextFile,
} from './context-collector'
import type { DiscoverContextEnv } from './context-files'

/**
 * Instructions that load as the agent works, as Claude Code loads them (memory.md):
 *
 * - a subdirectory's `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, its
 *   `.claude/rules/` and `.localix/` context "once Claude reads, writes, or edits another file in
 *   that subdirectory";
 * - a path-scoped rule anywhere in the session's chain (the user's, the project's) once a file its
 *   globs match has been worked with.
 *
 * `touched` are the absolute paths the session's file tools used; `loaded` are the session-stable
 * files (`discoverContextFiles`), which are not repeated. The result is a run's overlay: it grows
 * as the work moves, so it rides a volatile section rather than the cached project context.
 */
export async function discoverTouchedContextFiles(
  cwd: string | null | undefined,
  touched: readonly string[],
  loaded: readonly ContextFile[],
  env?: DiscoverContextEnv,
): Promise<ContextFile[]> {
  try {
    if (!cwd || cwd === '/' || touched.length === 0) return []
    const start = resolve(cwd)
    const home = env?.homeDir ?? homedir()
    const collector = new ContextCollector(
      env,
      loaded.map((file) => file.path),
    )
    const projectRoot = await gitRootAt(start)
    const scope = { unscoped: false, touched }

    // Path-scoped rules of the user and of every project directory from the root to cwd.
    await collectRules(join(home, '.localix', 'rules'), start, collector, undefined, scope)
    await collectRules(join(home, '.claude', 'rules'), start, collector, undefined, scope)
    for (const dir of chainBetween(projectRoot, start)) {
      await collectRules(join(dir, '.claude', 'rules'), dir, collector, projectRoot, scope)
      await collectRules(join(dir, '.localix', 'rules'), dir, collector, projectRoot, scope)
    }

    // Subdirectories below cwd that hold a touched file: everything they declare, root-first.
    const all = { unscoped: true, touched }
    for (const dir of subdirectoriesTouched(start, touched)) {
      await collectDir(dir, projectRoot, collector, true, all)
    }
    return collector.out
  } catch {
    return []
  }
}

/** The nearest directory at or above `start` holding `.git`, else `start` itself. */
async function gitRootAt(start: string): Promise<string> {
  const fsRoot = parse(start).root
  let cur = start
  while (true) {
    if (await isGitRoot(cur)) return cur
    if (cur === fsRoot) return start
    const parent = dirname(cur)
    if (parent === cur) return start
    cur = parent
  }
}

/** The directories from `root` down to `leaf`, both included (root-first). */
function chainBetween(root: string, leaf: string): string[] {
  const rel = relative(root, leaf)
  if (rel.startsWith('..')) return [leaf]
  const parts = rel ? rel.split(sep) : []
  return [root, ...parts.map((_, i) => join(root, ...parts.slice(0, i + 1)))]
}

/** Each directory strictly below `cwd` on the way to a touched file, root-first, once. */
function subdirectoriesTouched(cwd: string, touched: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const file of touched) {
    const rel = relative(cwd, dirname(file))
    if (!rel || rel.startsWith('..')) continue
    const parts = rel.split(sep)
    for (let i = 1; i <= parts.length; i++) {
      const dir = join(cwd, ...parts.slice(0, i))
      if (seen.has(dir) || parts[i - 1]!.startsWith('.')) break
      seen.add(dir)
      out.push(dir)
    }
  }
  return out
}
