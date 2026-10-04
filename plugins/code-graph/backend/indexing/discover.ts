import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import ignore, { type Ignore } from 'ignore'
import { languageOf, MAX_FILE_BYTES } from '../extract'
import { ALWAYS_SKIPPED } from '../../shared/changes'
import { excludedByRepo, readRepoExcludes, type ExcludeEnvironment } from './repo-excludes'

/**
 * Which files make up the project, honouring the project's own ignore rules.
 *
 * Not `git ls-files` and not `rg --files`: neither is guaranteed on a user's machine, and a map
 * that silently came out empty without git would be worse than none. So the walk is in-process and
 * reads `.gitignore` files the way git does — each one applies to its own directory and below —
 * through `ignore`, the matcher most JavaScript tools already trust for git's semantics. The
 * repository's own `info/exclude` and the global excludes file apply too (`repo-excludes.ts`).
 */
export interface DiscoveredFile {
  /** Project-relative POSIX path. */
  path: string
  size: number
  mtimeMs: number
}

export interface Discovery {
  files: DiscoveredFile[]
  /** Source files past the ceiling, not indexed. */
  omitted: number
  /** Project-relative paths of the files module resolution reads (see {@link CONFIG_FILES}). */
  configs: DiscoveredFile[]
}

/** How the project names its modules: path aliases, workspace packages, Go modules. */
export const CONFIG_FILES = new Set(['tsconfig.json', 'jsconfig.json', 'package.json', 'go.mod'])

/** A project larger than this is mapped up to it; the view says how many were left out. */
export const MAX_SOURCE_FILES = 20_000

interface Rules {
  /** Directory the rules are relative to, project-relative ('' for the root). */
  base: string
  matcher: Ignore
}

export async function discoverFiles(
  root: string,
  options: { excludes?: ExcludeEnvironment } = {},
): Promise<Discovery> {
  const files: DiscoveredFile[] = []
  const configs: DiscoveredFile[] = []
  let omitted = 0
  const repoRules = await readRepoExcludes(root, options.excludes).catch(() => null)
  const ignored = (rules: Rules[], path: string, directory: boolean) =>
    excludedByRepo(repoRules, path, directory) || ignoredByGitignores(rules, path, directory)
  const pending: Array<{ dir: string; rules: Rules[] }> = [{ dir: '', rules: [] }]

  while (pending.length > 0) {
    const { dir, rules: inherited } = pending.pop() as { dir: string; rules: Rules[] }
    const absolute = dir ? join(root, dir) : root
    const entries = await readdir(absolute, { withFileTypes: true }).catch(() => [])
    const own = entries.some((entry) => entry.isFile() && entry.name === '.gitignore')
      ? await readRules(absolute, dir)
      : null
    const rules = own ? [...inherited, own] : inherited
    // Sorted so discovery order, and with it every ordinal the build assigns, is stable.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const path = dir ? `${dir}/${entry.name}` : entry.name
      // Symlinks are skipped: they are how a walk ends up in a loop or outside the project.
      if (entry.isDirectory()) {
        if (!ALWAYS_SKIPPED.has(entry.name) && !ignored(rules, path, true)) {
          pending.push({ dir: path, rules })
        }
      } else if (entry.isFile() && CONFIG_FILES.has(entry.name) && !ignored(rules, path, false)) {
        const info = await stat(join(root, path)).catch(() => null)
        if (info) configs.push({ path, size: info.size, mtimeMs: info.mtimeMs })
      } else if (entry.isFile() && languageOf(entry.name) && !ignored(rules, path, false)) {
        if (files.length >= MAX_SOURCE_FILES) {
          omitted += 1
          continue
        }
        const info = await stat(join(root, path)).catch(() => null)
        if (info && info.size <= MAX_FILE_BYTES) {
          files.push({ path, size: info.size, mtimeMs: info.mtimeMs })
        }
      }
    }
  }
  files.sort(byPath)
  configs.sort(byPath)
  return { files, omitted, configs }
}

const byPath = (a: DiscoveredFile, b: DiscoveredFile) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0

async function readRules(absoluteDir: string, base: string): Promise<Rules | null> {
  const text = await readFile(join(absoluteDir, '.gitignore'), 'utf8').catch(() => null)
  return text === null ? null : { base, matcher: ignore().add(text) }
}

function ignoredByGitignores(rules: Rules[], path: string, directory: boolean): boolean {
  for (const { base, matcher } of rules) {
    const relative = base ? path.slice(base.length + 1) : path
    if (relative && matcher.ignores(directory ? `${relative}/` : relative)) return true
  }
  return false
}
