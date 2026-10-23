import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { killProcessTreeNow } from './process-tree'

/**
 * Spawn the user's login shell and read back its WHOLE environment — the I/O half of
 * `login-shell-env.ts`, which owns caching and merging.
 *
 * Interactive+login (`-ilc`) first so version-manager rc files load; login-only (`-lc`)
 * second for setups whose rc bails without a TTY. Both share ONE budget: two independent
 * 5 s timeouts meant a slow rc could hold boot for 10 s, against a desktop shell that kills
 * a start attempt at 12 s — so a slow `.zshrc` turned into a kill/retry loop. A timeout
 * kills with SIGKILL, and the whole process group: an rc that traps or ignores SIGTERM
 * (oh-my-zsh update prompts, `trap '' TERM`) survived the old SIGTERM, and a background
 * job it started kept our stdout pipe open.
 */

const START = '__LOCALIX_ENV_START__'
const END = '__LOCALIX_ENV_END__'
const SCRIPT = `printf '%s' '${START}'; env -0; printf '%s' '${END}'`
const FLAG_SETS: readonly string[][] = [['-ilc'], ['-lc']]

/** Both probes together, not each. */
export const PROBE_BUDGET_MS = 3_000

/**
 * How long output may still arrive after the shell exits. A dependency-free copy of the
 * child-exit drain rather than an import of it: this module sits under `childEnv`, which
 * every spawn in the API reaches, and must not pull the mini app SDK into that path.
 */
const EXIT_DRAIN_MS = 100

/** An environment dump is tens of KiB; anything past this is not one. */
const MAX_DUMP_CHARS = 4 * 1024 * 1024

// Strip ANSI/OSC escapes an interactive prompt (p10k/oh-my-zsh) might emit.
// oxlint-disable-next-line no-control-regex -- matches ESC-introduced ANSI/OSC escapes
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g

/** Parse the NUL-delimited dump between our sentinels; banner/MOTD noise is discarded. */
export function parseEnvDump(raw: string): Record<string, string> | undefined {
  const out = raw.replace(ANSI, '')
  const s = out.indexOf(START)
  const e = out.indexOf(END, s + START.length)
  if (s === -1 || e === -1) return undefined
  const vars: Record<string, string> = {}
  for (const pair of out.slice(s + START.length, e).split('\0')) {
    const i = pair.indexOf('=')
    if (i > 0) vars[pair.slice(0, i)] = pair.slice(i + 1)
  }
  return Object.keys(vars).length ? vars : undefined
}

/** Blocking probe, for a caller that needs the answer on this turn (CLI, a spawn mid-probe). */
export function probeShellEnvSync(
  shell: string,
  env: NodeJS.ProcessEnv,
  budgetMs = PROBE_BUDGET_MS,
): Record<string, string> | undefined {
  const deadline = Date.now() + budgetMs
  for (const flags of FLAG_SETS) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return undefined
    try {
      const r = spawnSync(shell, [...flags, SCRIPT], {
        encoding: 'utf8',
        timeout: remaining,
        killSignal: 'SIGKILL',
        maxBuffer: MAX_DUMP_CHARS,
        // Clean, non-interactive stdin so the shell can't block waiting on input.
        stdio: ['ignore', 'pipe', 'ignore'],
        env,
        windowsHide: true,
      })
      const vars = parseEnvDump(r.stdout ?? '')
      if (vars) return vars
    } catch {
      /* try the next flag set within what is left */
    }
  }
  return undefined
}

function runOnce(
  shell: string,
  flags: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(shell, [...flags, SCRIPT], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env,
        // Its own group, so the timeout reaches whatever the rc started.
        detached: process.platform !== 'win32',
        windowsHide: true,
      })
    } catch {
      resolve('')
      return
    }
    let out = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (out.length < MAX_DUMP_CHARS) out += chunk
    })
    // A probe past its budget is abandoned, not asked to stop: SIGKILL the group at once.
    const timer = setTimeout(() => killProcessTreeNow(child.pid), timeoutMs)
    timer.unref?.()
    let drain: ReturnType<typeof setTimeout> | undefined
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      clearTimeout(drain)
      // A job the rc backgrounded can hold our stdout open forever; detach from it.
      child.stdout?.destroy()
      resolve(out)
    }
    child.once('close', finish)
    child.once('error', finish)
    // The shell exited: give its output a moment to drain, then stop waiting on the pipe.
    child.once('exit', () => {
      clearTimeout(timer)
      drain = setTimeout(finish, EXIT_DRAIN_MS)
      drain.unref?.()
    })
  })
}

/** Non-blocking probe: the event loop keeps serving while the rc files run. */
export async function probeShellEnv(
  shell: string,
  env: NodeJS.ProcessEnv,
  budgetMs = PROBE_BUDGET_MS,
): Promise<Record<string, string> | undefined> {
  const deadline = Date.now() + budgetMs
  for (const flags of FLAG_SETS) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return undefined
    const vars = parseEnvDump(await runOnce(shell, flags, env, remaining))
    if (vars) return vars
  }
  return undefined
}
