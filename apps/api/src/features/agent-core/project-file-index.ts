import { shellQuote, type ExecutionEnvironment } from './tools/environment'

/** A generous path-count ceiling shared by prompt discovery and editor search. */
export const MAX_INDEXED_FILES = 100_000

export interface IndexedProjectFiles {
  paths: string[]
  omitted: number
}

export function includeIgnoredRgFlags(): string[] {
  return [
    '--no-ignore-vcs',
    '--glob',
    shellQuote('!**/node_modules/**'),
    '--glob',
    shellQuote('!**/.git/**'),
  ]
}

/**
 * Read the project-relative file index through the run's execution backend.
 * The result is complete up to a documented path-count ceiling; stdout itself
 * is intentionally uncapped so a byte-tail truncation cannot silently lose the
 * beginning of a large tree.
 */
export async function loadProjectFileIndex(
  env: ExecutionEnvironment,
  root: string,
  includeIgnored = false,
): Promise<IndexedProjectFiles> {
  // `-0` NUL-terminates each path: a newline split + trim turned `name.ts ` into a path that
  // does not exist and broke a name with an embedded newline into two.
  const command = ['rg', '--files', '-0', ...(includeIgnored ? includeIgnoredRgFlags() : [])].join(
    ' ',
  )
  const result = await env.exec(command, { cwd: root, uncapped: true })
  if (result.exitCode === 127) throw new Error('ripgrep unavailable')
  if (result.exitCode !== 0 && result.exitCode !== 1 && !result.stdout.trim()) {
    throw new Error(result.stderr.trim() || `ripgrep failed (exit code ${result.exitCode})`)
  }

  const paths = result.stdout.split('\0').filter(Boolean)
  const omitted = Math.max(0, paths.length - MAX_INDEXED_FILES)
  return {
    paths: omitted > 0 ? paths.slice(0, MAX_INDEXED_FILES) : paths,
    omitted,
  }
}
