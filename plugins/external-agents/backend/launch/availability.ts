/**
 * WHICH agent CLIs are actually installed on this machine.
 *
 * The quick-action menu used to offer all six unconditionally, because the only honest answer the
 * plugin had was "the shell will tell you". It did — inside a pane the click had just opened, as
 * `zsh: command not found: copilot`. That is a real answer given in the wrong place: the person
 * asked for a menu of things they can run, and got a menu of things that exist somewhere.
 *
 * WHY A PATH SCAN AND NOT A SPAWN. `apps/api` folds the user's LOGIN-SHELL environment into
 * `process.env` at boot (`lib/login-shell-env.ts`), precisely so children resolve tools the way the
 * user's terminal does — version-manager shims included. So `process.env.PATH` here IS the PATH the
 * pane will run under, and an `access(X_OK)` against it answers the question with no shell, no
 * command string, and nothing interpolated from anywhere. Spawning `command -v` six times would
 * cost seconds on a cold `.zshrc` for the same answer.
 *
 * WHAT IT DELIBERATELY MISSES: a shell alias or function named `claude`. Those live in the rc file,
 * not on PATH, and no scan can see them. The cost of that miss is one launcher hidden from someone
 * who wrapped their CLI in a function — against a menu that offers six agents to a machine holding
 * one. The trade is stated here rather than discovered.
 */

import { access, constants } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'

import { AGENT_LAUNCHERS, type AgentCliStatus, type AgentLauncher } from '../../shared/launch'

/** How long a reading stays good. Installing a CLI is rare; re-scanning on every menu is not free. */
export const AVAILABILITY_TTL_MS = 60_000

/**
 * PATH entries we are willing to look in.
 *
 * A RELATIVE entry (`.`, `node_modules/.bin`) is legal in PATH and resolves against the CURRENT
 * working directory — this process's, which is not the one the pane will run in. Answering from it
 * would be a guess dressed as a measurement, so those entries are skipped. The cap is there because
 * a pathological PATH is the one input to this function and it comes from the environment.
 */
const MAX_PATH_ENTRIES = 256

function searchDirs(pathValue: string | undefined): string[] {
  if (!pathValue) return []
  const seen = new Set<string>()
  const dirs: string[] = []
  for (const entry of pathValue.split(delimiter)) {
    const dir = entry.trim()
    if (!dir || !isAbsolute(dir) || seen.has(dir)) continue
    seen.add(dir)
    dirs.push(dir)
    if (dirs.length >= MAX_PATH_ENTRIES) break
  }
  return dirs
}

/**
 * Names to try for one executable. On Windows a bare `claude` is really `claude.cmd`/`claude.exe`,
 * and the executable BIT is not how that platform marks a program — so the extension list is the
 * check there, and `access(X_OK)` degrades to an existence test.
 */
function candidateNames(executable: string, pathExt: string | undefined): string[] {
  if (process.platform !== 'win32') return [executable]
  const exts = (pathExt ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((ext) => ext.trim())
    .filter(Boolean)
  return [executable, ...exts.map((ext) => `${executable}${ext}`)]
}

export interface AvailabilityDeps {
  /** The PATH to search. Injected so a test never depends on the developer's own machine. */
  readonly pathValue?: () => string | undefined
  readonly pathExt?: () => string | undefined
  /** Executable-file predicate. Overridden in tests; never throws in production. */
  readonly isExecutable?: (candidate: string) => Promise<boolean>
  readonly launchers?: readonly AgentLauncher[]
  readonly now?: () => number
  readonly ttlMs?: number
}

async function defaultIsExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK)
    return true
  } catch {
    // ENOENT, EACCES on the directory, a dangling symlink — all mean "not runnable from here".
    return false
  }
}

/**
 * Resolve ONE launcher against the search path, first match winning exactly as the shell's own
 * lookup does. Directories are walked in order and candidates within a directory in PATHEXT order;
 * the two loops are sequential on purpose, because the ANSWER is order-dependent and a
 * `Promise.all` would return whichever `access` happened to settle first.
 */
async function resolveOne(
  launcher: AgentLauncher,
  dirs: readonly string[],
  names: readonly string[],
  isExecutable: (candidate: string) => Promise<boolean>,
): Promise<AgentCliStatus> {
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name)
      if (await isExecutable(candidate)) {
        return { ...launcher, available: true, path: candidate }
      }
    }
  }
  return { ...launcher, available: false }
}

export interface AgentCliProbe {
  /**
   * The reading, from cache when it is still good. `refresh` is the person pressing "Check again"
   * after installing something — the one case where the TTL is the wrong answer.
   */
  list(options?: { refresh?: boolean }): Promise<readonly AgentCliStatus[]>
}

/**
 * A probe with its own cache.
 *
 * An instance rather than module state so the service owns its lifetime and a test gets a clean
 * one. The cache is keyed on the PATH ITSELF, not just on time: a PATH change (a version manager
 * activating, a plugin prepending a `bin/`) means the previous reading answered a different
 * question, and a TTL would keep serving it. In-flight calls share one scan, so a menu that renders
 * three times before the first answer lands still performs one pass.
 */
export function createAgentCliProbe(deps: AvailabilityDeps = {}): AgentCliProbe {
  const readPath = deps.pathValue ?? (() => process.env.PATH)
  const readPathExt = deps.pathExt ?? (() => process.env.PATHEXT)
  const isExecutable = deps.isExecutable ?? defaultIsExecutable
  const launchers = deps.launchers ?? AGENT_LAUNCHERS
  const now = deps.now ?? Date.now
  const ttlMs = deps.ttlMs ?? AVAILABILITY_TTL_MS

  let cached: { key: string; at: number; result: readonly AgentCliStatus[] } | undefined
  let inFlight: { key: string; promise: Promise<readonly AgentCliStatus[]> } | undefined

  async function scan(pathValue: string | undefined): Promise<readonly AgentCliStatus[]> {
    const dirs = searchDirs(pathValue)
    const pathExt = readPathExt()
    return await Promise.all(
      launchers.map((launcher) =>
        resolveOne(launcher, dirs, candidateNames(launcher.executable, pathExt), isExecutable),
      ),
    )
  }

  return {
    async list(options) {
      const key = readPath() ?? ''
      if (!options?.refresh && cached?.key === key && now() - cached.at < ttlMs) {
        return cached.result
      }
      if (!options?.refresh && inFlight?.key === key) return await inFlight.promise
      const promise = scan(key).then((result) => {
        cached = { key, at: now(), result }
        return result
      })
      inFlight = { key, promise }
      try {
        return await promise
      } finally {
        if (inFlight?.promise === promise) inFlight = undefined
      }
    },
  }
}
