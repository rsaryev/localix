/**
 * Shared kernel for the /review dynamic-option scripts (branches/commits/prs).
 *
 * Each script follows the host's arg-options contract (see
 * `apps/api/src/features/plugins/arg-options.ts` and docs/extending/plugins.md →
 * "Dynamic command arguments"): the host runs it with `bun` in the session's
 * working directory, hands it a JSON request on stdin (`{ query, cwd, … }`, with
 * `LOCALIX_ARG_QUERY`/`LOCALIX_CWD` env fallbacks), and reads an `ArgOption[]`
 * JSON off stdout. Any failure must yield `[]` — never a hang, never a throw.
 *
 * This module splits that into an IO shell (`readRequest`, `runLines`,
 * `emitOptions`) and pure helpers (`splitTab`, `matchesQuery`) the scripts share.
 */

export interface ArgOption {
  value: string
  label: string
  description?: string
}

interface Request {
  query?: string
  cwd?: string
}

/** IO: read the host request off stdin (env-var fallbacks). Never throws. */
export async function readRequest(): Promise<{ query: string; cwd: string }> {
  let req: Request = {}
  try {
    req = JSON.parse((await Bun.stdin.text()) || '{}') as Request
  } catch {
    // Malformed stdin — fall through to the env-var fallbacks.
  }
  return {
    query: (req.query ?? Bun.env.LOCALIX_ARG_QUERY ?? '').toLowerCase(),
    cwd: req.cwd || Bun.env.LOCALIX_CWD || process.cwd(),
  }
}

/**
 * IO: run a command and return its stdout lines (blank lines dropped), or `null`
 * on any failure — nonzero exit or a missing binary (spawn throws ENOENT).
 * The caller maps `null` to an empty menu.
 *
 * Bounded by its own timeout: the host kills only this script's process on ITS deadline, not the
 * command it spawned, so a stalled `gh pr list` outlived the menu request — one per keystroke.
 */
export const RUN_LINES_TIMEOUT_MS = 5_000

export function runLines(
  argv: string[],
  cwd: string,
  timeoutMs = RUN_LINES_TIMEOUT_MS,
): string[] | null {
  try {
    const proc = Bun.spawnSync(argv, { cwd, timeout: timeoutMs })
    if (!proc.success) return null
    return new TextDecoder().decode(proc.stdout).split('\n').filter(Boolean)
  } catch {
    return null
  }
}

/** Pure: split a `head<TAB>rest` line; a line without a tab yields `[line, '']`. */
export function splitTab(line: string): [head: string, rest: string] {
  const tab = line.indexOf('\t')
  return tab === -1 ? [line, ''] : [line.slice(0, tab), line.slice(tab + 1)]
}

/** Pure: case-insensitive substring match (query is pre-lowercased by readRequest); an empty query matches everything. */
export function matchesQuery(query: string, ...haystacks: string[]): boolean {
  if (!query) return true
  return haystacks.some((h) => h.toLowerCase().includes(query))
}

/** IO: write the options JSON the host reads off stdout. */
export function emitOptions(options: ArgOption[]): void {
  console.log(JSON.stringify(options))
}
