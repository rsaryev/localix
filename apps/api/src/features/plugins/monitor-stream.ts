import { mkdirSync } from 'node:fs'

import { createLineSplitter, MAX_LINE_CHARS } from '../../lib/line-splitter'
import { resolveShellConfig } from '../agent-core/tools/environments/shell'
import type { LoadedPluginMonitor } from './loader'

/**
 * Spawn + stdout-stream primitives for the monitor host, split out so the host
 * module stays focused on lifecycle. Pure I/O helpers: process spawn shape, the
 * `${CLAUDE_*}` command substitution, a per-monitor rate gate, and the line pump.
 */

/** Rate cap: at most this many lines per {@link RATE_WINDOW_MS} per monitor. */
export const MAX_LINES_PER_WINDOW = 20
export const RATE_WINDOW_MS = 1_000
/**
 * A single line longer than this is truncated (chars ≈ bytes for the cap). Re-exported from
 * the shared splitter rather than declared again: the agent-facing `monitor` counts events in
 * lines through the same module, and two caps drifting apart would mean "one line" meant two
 * different things depending on which monitor produced it.
 */
export const MAX_LINE_LEN = MAX_LINE_CHARS

/** Minimal spawned-process shape the host drives — satisfied by `Bun.spawn`. */
export interface MonitorProc {
  stdout: ReadableStream<Uint8Array> | null
  kill: () => void
  exited: Promise<number>
}
export type MonitorSpawner = (
  command: string,
  opts: { cwd: string; env: Record<string, string | undefined> },
) => MonitorProc

/** One monitor stdout line, ready for the delivery seam. */
export interface MonitorNotification {
  pluginName: string
  monitorName: string
  /** Manifest `description` (shown in the task panel). */
  description: string
  line: string
  /** The sessions the monitor was ARMED for (monitor-arms.ts) — never empty when delivered. */
  sessionIds: readonly string[]
}

/**
 * Default spawner — the resolved agent shell (`bash -c <command>`), stdout piped,
 * stderr/stdin dropped.
 *
 * Through `resolveShellConfig`, not a literal `sh`: Windows has no `sh` on PATH unless Git's
 * `usr\bin` happens to be there, so every plugin monitor failed to start on a stock Windows
 * install while the agent's own commands — resolved to Git Bash — ran fine.
 */
export const defaultSpawn: MonitorSpawner = (command, opts) => {
  const bun = (globalThis as { Bun?: { spawn: (cmd: string[], o: unknown) => MonitorProc } }).Bun
  if (!bun) throw new Error('Bun.spawn unavailable')
  const { shell, args } = resolveShellConfig()
  return bun.spawn([shell, ...args, command], {
    cwd: opts.cwd,
    env: opts.env,
    stdout: 'pipe',
    stderr: 'ignore',
    stdin: 'ignore',
    windowsHide: true,
  })
}

/**
 * Prepare a monitor command for the shell. `${CLAUDE_PROJECT_DIR}` / `${CLAUDE_PLUGIN_ROOT}` /
 * `${CLAUDE_PLUGIN_DATA}` are NOT pasted in: the shell expands them from the env the host sets.
 *
 * Pasting was command injection: the shell parses the command as source, so a project folder
 * named `x$(touch PWNED)` ran `touch PWNED` the moment the monitor started. A shell never re-parses
 * an expansion, so leaving the placeholder (which is ordinary shell syntax) makes the path data.
 * The one job left here is creating the data dir a command refers to before it runs.
 */
export function substituteCommand(command: string, m: LoadedPluginMonitor): string {
  if (command.includes('CLAUDE_PLUGIN_DATA')) {
    try {
      mkdirSync(m.dataDir, { recursive: true })
    } catch {
      // best-effort — a monitor referencing a dir we can't create still spawns
    }
  }
  return command
}

/**
 * Per-monitor rate limiter: returns a predicate that admits at most
 * {@link MAX_LINES_PER_WINDOW} lines per window, dropping bursts past the cap and
 * invoking `onDrop` once per exceeded window.
 *
 * DROP, where an agent's own watch is STOPPED (`features/monitors/batch.ts`), and on purpose:
 * the user installed this monitor to watch indefinitely, it belongs to no session, and no line
 * of it is a turn the agent asked for — so a burst is noise to shed, not a verdict on a filter.
 * An agent's watch is the agent's choice and every event buys a turn, so flooding there is a
 * mistake in the filter, and the useful answer is to end it and say so.
 */
export function createRateGate(now: () => number, onDrop: () => void): (line: string) => boolean {
  let windowStart = now()
  let count = 0
  let warned = false
  return () => {
    const t = now()
    if (t - windowStart >= RATE_WINDOW_MS) {
      windowStart = t
      count = 0
      warned = false
    }
    if (count >= MAX_LINES_PER_WINDOW) {
      if (!warned) {
        warned = true
        onDrop()
      }
      return false
    }
    count += 1
    return true
  }
}

/**
 * Read a monitor's stdout stream line-by-line until it closes or `signal` aborts,
 * calling `onLine` per non-empty line (long lines truncated). Never throws — a
 * stream error simply ends the pump (the process is reaped by the host).
 */
export async function pumpLines(
  proc: MonitorProc,
  signal: AbortSignal,
  onLine: (line: string) => void,
): Promise<void> {
  const stream = proc.stdout
  if (!stream) return
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  // Line assembly + the length cap live in `lib/line-splitter` (shared with the agent's own
  // `monitor` tool). This function keeps only what is specific to a piped process: the reader
  // loop, the abort, and the lock release.
  const splitter = createLineSplitter(MAX_LINE_LEN)
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      for (const line of splitter.push(decoder.decode(value, { stream: true }))) onLine(line)
    }
    if (!signal.aborted) for (const line of splitter.flush()) onLine(line)
  } catch {
    // stream error → monitor output ends
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* already released */
    }
  }
}
