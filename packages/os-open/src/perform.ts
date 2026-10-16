/**
 * Running an OS handoff and REPORTING WHAT HAPPENED.
 *
 * The rule this module exists to enforce: an outward action must never fail
 * quietly. Fire-and-forget spawning was how "the link is dead" and "the link
 * worked" became the same observable event — no status, no log line, nothing for
 * anyone to act on. So every attempt is logged (not only the failures: an empty
 * log must not mean both "never called" and "called and ignored"), every opener
 * is waited on, and the answer is a value the caller has to look at.
 *
 * What this CANNOT tell you: whether the handler that accepted the target
 * actually showed anything. `open` reports success once LaunchServices delivers
 * the URL — even to a stale background instance of the browser that drops it. The
 * log line is what makes that case diagnosable, which is the whole reason it is
 * unconditional.
 */

import { spawn as nodeSpawn } from 'node:child_process'

import { currentPlatform, handoffCommand, type Handoff, type OsPlatform } from './command'

export type HandoffResult = { ok: true } | { ok: false; reason: string }

export interface HandoffOptions {
  /** Override the platform. Tests use it; production reads `process.platform`. */
  platform?: OsPlatform
  /**
   * Every attempt, in one line. Wire it to the surface's own log — the API's
   * logger, the shell log — so a dead handoff leaves a trace where someone looks.
   */
  log?: (line: string) => void
  /** Spawn seam, so the table and the reporting are testable without a machine. */
  spawn?: typeof nodeSpawn
  /**
   * How long an OPENER may take before we stop believing it. Openers exit in
   * milliseconds; one that does not is stuck, and a caller waiting forever is a
   * hang, not a handoff. The child is left alone — it may still succeed — but the
   * caller gets its answer.
   */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000

/**
 * A target that begins with `-` would be read as a FLAG by `open`/`xdg-open`,
 * which is how a hostile file name reaches an opener's option parser. Neither
 * accepts a `--` end-of-options marker, so refusing is the whole defence.
 */
function targetOf(target: Handoff): string {
  return target.kind === 'url' ? target.url : target.path
}

export async function performHandoff(
  target: Handoff,
  options: HandoffOptions = {},
): Promise<HandoffResult> {
  const log = options.log ?? (() => {})
  const raw = targetOf(target)
  if (raw.trim() === '') {
    log(`os-open: refused an empty ${target.kind} target`)
    return { ok: false, reason: 'There is nothing to open.' }
  }
  if (raw.startsWith('-')) {
    log(`os-open: refused a flag-shaped ${target.kind} target`)
    return {
      ok: false,
      reason: 'That name starts with a dash, which the system opener reads as an option.',
    }
  }

  const platform = options.platform ?? currentPlatform()
  const command = handoffCommand(platform, target)
  const spawn = options.spawn ?? nodeSpawn
  log(`os-open ${target.kind} → ${raw}`)

  return command.awaits === 'exit'
    ? awaitExit(command, spawn, options, log)
    : awaitSpawn(command, spawn, log)
}

type Command = ReturnType<typeof handoffCommand>

/** The process is an opener: its exit status is an answer, and stderr is a sentence. */
function awaitExit(
  command: Command,
  spawn: typeof nodeSpawn,
  options: HandoffOptions,
  log: (line: string) => void,
): Promise<HandoffResult> {
  return new Promise<HandoffResult>((resolve) => {
    let settled = false
    const settle = (result: HandoffResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!result.ok) log(`os-open failed: ${command.cmd} — ${result.reason}`)
      resolve(result)
    }

    const child = spawn(command.cmd, command.args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })
    const timer = setTimeout(() => {
      // Deliberately NOT killed: it may yet do the thing. The caller just stops
      // waiting on a process that has already broken its own contract.
      settle({ ok: false, reason: 'The system opener did not answer.' })
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    if (typeof timer.unref === 'function') timer.unref()

    child.on('error', (error: Error) => {
      settle({ ok: false, reason: `The system opener could not be started: ${error.message}` })
    })
    child.on('exit', (code: number | null) => {
      if (code === 0 || (command.lenientExit && code != null)) return settle({ ok: true })
      const detail = stderr.trim()
      settle({
        ok: false,
        reason: detail || `The system opener refused this target (exit ${code ?? 'signal'}).`,
      })
    })
  })
}

/**
 * The process IS the application. Waiting would last as long as its window does,
 * so the answer is whether it started — the only thing knowable without lying.
 */
function awaitSpawn(
  command: Command,
  spawn: typeof nodeSpawn,
  log: (line: string) => void,
): Promise<HandoffResult> {
  return new Promise<HandoffResult>((resolve) => {
    let settled = false
    const settle = (result: HandoffResult) => {
      if (settled) return
      settled = true
      if (!result.ok) log(`os-open failed: ${command.cmd} — ${result.reason}`)
      resolve(result)
    }
    const child = spawn(command.cmd, command.args, { detached: true, stdio: 'ignore' })
    child.on('error', (error: Error) => {
      settle({ ok: false, reason: `${command.cmd} could not be started: ${error.message}` })
    })
    child.on('spawn', () => {
      child.unref()
      settle({ ok: true })
    })
  })
}
