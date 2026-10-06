/**
 * Native change signals for the agents' own history, so nothing has to poll it to learn it moved.
 *
 * THE DEFECT. Two readers found out about new history by asking on a timer. The roster panel
 * re-enumerated every provider's root on each tick (a readdir and a stat per session file, ~2,000
 * here) whether or not anything had been written; and a `wait` re-enumerated a provider's whole
 * history every 2 s per waited key just to find the one log it then tailed — while still noticing
 * a finished turn up to a full tick late.
 *
 * WHOSE WATCHER. The host's (`ctx.watchPath`, passed in by the service): the native backend that
 * reports every change of a burst and reports a dropped-events overflow as an error. Bun's own
 * recursive `fs.watch` on macOS delivers only part of a burst (3 of 14 changes in a measured
 * burst, deletes and renames often none), so with it a turn an agent just finished could wait for
 * the 5-minute roster backstop. `runtimeWatch` below remains only for a load the host gave no
 * watcher (a per-run tool load before the boot load ran, tests); what it may miss — and what any
 * watcher misses, a root created after the watch armed — the callers' slow backstop still
 * catches, so the watch is an accelerator, never the only way to learn.
 */
import { watch } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

import type { RootProbe } from '../adapters/types'
import type { HistoryFrame } from '../../shared/history-stream'

/** Start watching `path`; `onEvent` gets the changed entry's name when the platform knows it. */
export type WatchPath = (
  path: string,
  recursive: boolean,
  onEvent: (name: string | null) => void,
  onError: () => void,
) => () => void

/** The runtime's own `fs.watch` — the fallback when the host provided no watcher (see above). */
export const runtimeWatch: WatchPath = (path, recursive, onEvent, onError) => {
  const watcher = watch(path, { recursive, persistent: false }, (_event, name) =>
    onEvent(typeof name === 'string' ? name : null),
  )
  watcher.on('error', onError)
  return () => watcher.close()
}

/**
 * The watcher a process singleton holds across loads: only the boot load hands over the host's
 * watcher, and a later per-run load (which has none) must not drop it. `watch` resolves per call,
 * so a watch armed after the hand-over uses it even if its owner was built earlier.
 */
export function hostWatchSlot(): { set(watch: WatchPath | undefined): void; watch: WatchPath } {
  let host: WatchPath | undefined
  return {
    set: (watch) => void (watch && (host = watch)),
    watch: (...args) => (host ?? runtimeWatch)(...args),
  }
}

/**
 * One window per burst: the first change opens it and one notice leaves when it closes. An agent
 * appending a line a second must cost one re-read per window, not one per line.
 */
export const HISTORY_WINDOW_MS = 5_000

/**
 * Watch one root. A directory is watched recursively. A FILE root is a database (opencode, Hermes):
 * its writes land as often in its `-wal`/`-journal` siblings as in the file itself, so the parent
 * is watched, flat, for anything named after it.
 */
async function watchRoot(path: string, watchPath: WatchPath, bump: () => void, lost: () => void) {
  if ((await stat(path)).isDirectory()) return watchPath(path, true, bump, lost)
  const name = basename(path)
  return watchPath(
    dirname(path),
    false,
    (entry) => (!entry || entry.startsWith(name) ? bump() : undefined),
    lost,
  )
}

/**
 * The machine-wide history watch, armed only while someone listens: a closed panel watches nothing.
 */
export class HistoryWatch {
  private readonly roots: () => Promise<readonly RootProbe[]>
  private readonly options: { windowMs?: number; watchPath?: WatchPath }
  private readonly listeners = new Set<(frame: HistoryFrame) => void>()
  private closers: (() => void)[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private live: boolean | null = null
  /** Bumped on every disarm, so an arm still resolving its roots never outlives its listeners. */
  private generation = 0

  constructor(
    roots: () => Promise<readonly RootProbe[]>,
    options: { windowMs?: number; watchPath?: WatchPath } = {},
  ) {
    this.roots = roots
    this.options = options
  }

  subscribe(listener: (frame: HistoryFrame) => void): () => void {
    this.listeners.add(listener)
    if (this.listeners.size === 1) void this.arm()
    else if (this.live !== null) listener({ live: this.live })
    return () => {
      if (this.listeners.delete(listener) && this.listeners.size === 0) this.disarm()
    }
  }

  close(): void {
    this.listeners.clear()
    this.disarm()
  }

  private emit(frame: HistoryFrame): void {
    for (const listener of this.listeners) listener(frame)
  }

  private setLive(live: boolean): void {
    if (this.live === live) return
    this.live = live
    this.emit({ live })
  }

  private async arm(): Promise<void> {
    const generation = this.generation
    const watchPath = this.options.watchPath ?? runtimeWatch
    const probes = await this.roots().catch(() => [])
    for (const probe of probes) {
      if (!probe.exists) continue
      const close = await watchRoot(
        probe.path,
        watchPath,
        () => this.bump(),
        () => this.lost(),
      ).catch(() => null)
      if (generation !== this.generation) {
        close?.()
        return
      }
      if (close) this.closers.push(close)
    }
    this.setLive(this.closers.length > 0)
  }

  private bump(): void {
    if (this.timer || this.listeners.size === 0) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.emit({ changed: true })
    }, this.options.windowMs ?? HISTORY_WINDOW_MS)
  }

  /** A watcher that failed may have dropped events: say so, re-read once, and stop claiming live. */
  private lost(): void {
    this.setLive(false)
    this.emit({ changed: true })
  }

  private disarm(): void {
    this.generation += 1
    clearTimeout(this.timer)
    this.timer = undefined
    for (const close of this.closers) close()
    this.closers = []
    this.live = null
  }
}

/**
 * Watch a few known files — the logs a `wait` tails — and call `onChange` once per short burst.
 * Returns the release. A path that cannot be watched is skipped: the wait's own tick still reads it.
 */
export function watchFiles(
  paths: readonly string[],
  onChange: () => void,
  options: { windowMs?: number; watchPath?: WatchPath } = {},
): () => void {
  const watchPath = options.watchPath ?? runtimeWatch
  let timer: ReturnType<typeof setTimeout> | undefined
  const bump = () => {
    timer ??= setTimeout(() => {
      timer = undefined
      onChange()
    }, options.windowMs ?? 100)
  }
  const closers = paths.flatMap((path) => {
    try {
      return [watchPath(path, false, bump, () => {})]
    } catch {
      return []
    }
  })
  return () => {
    clearTimeout(timer)
    for (const close of closers) close()
  }
}
