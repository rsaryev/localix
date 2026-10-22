import { createThrottle } from '../../../../lib/debounce'
import type { WaitRequest } from './waiters'
import { watchFiles, type WatchPath } from './history-watch'

/** Fallback re-read period, used only when the host cannot tell this load a pane changed. */
const WAIT_POLL_MS = 2_000

/** At most one screen read per pane per window while its program is printing. */
export const SCREEN_READ_GAP_MS = 750

/** Subscribe to a waited pane; null when the key has no live pane this session may read. */
export type WatchScreen = (
  key: string,
  sessionId: string | null,
  onEvent: (event: 'output' | 'exit') => void,
) => (() => void) | null

interface WaitPollOptions {
  readonly request: WaitRequest
  readonly sessionId?: string | null
  readonly hasTerminalRead: () => boolean
  /** The host's pane events, when it offers them; without them the wait falls back to a timer. */
  readonly watchScreen?: WatchScreen
  readonly readScreen: (key: string, sessionId: string | null) => Promise<string | null>
  /** The pane exited or is gone: take its final reading and retire the delegation. */
  readonly readEnd: (key: string, sessionId: string | null) => Promise<void>
  readonly readTurnsFor: (keys: readonly string[]) => Promise<void>
  readonly timers: () => Set<ReturnType<typeof setTimeout>>
  readonly sourcePath: (key: string) => string | undefined
  readonly watchPath: () => WatchPath
  /** Injected by tests; defaults to {@link SCREEN_READ_GAP_MS} and the wall clock. */
  readonly screenGapMs?: number
  readonly now?: () => number
}

/** Arm the readers synchronously; the returned release stops every one of them. */
export function startWaitPoll(options: WaitPollOptions): () => void {
  const { request } = options
  const sessionId = options.sessionId ?? null
  const stopScreens =
    options.hasTerminalRead() && options.watchScreen
      ? watchScreens(options, options.watchScreen, sessionId)
      : pollScreens(options, sessionId)
  // A log has a change event: its watch re-reads the waited turns once per short burst.
  const logs = new Set(request.keys.flatMap((key) => options.sourcePath(key) ?? []))
  const unwatchLogs = watchFiles(
    [...logs],
    () => void options.readTurnsFor(request.keys).catch(() => null),
    { watchPath: options.watchPath() },
  )
  return () => {
    unwatchLogs()
    stopScreens()
  }
}

/**
 * A pane's screen changes only when its program prints or exits, so those are what re-read it.
 * Output is throttled per pane — a chatty agent costs one VT render per window, a silent one none —
 * and its log is read with it, since a degraded screen defers to the log. An exit is read at once.
 */
function watchScreens(
  options: WaitPollOptions,
  watchScreen: WatchScreen,
  sessionId: string | null,
): () => void {
  const readEnd = (key: string) => void options.readEnd(key, sessionId).catch(() => null)
  const releases = options.request.keys.map((key) => {
    const throttle = createThrottle(options.screenGapMs ?? SCREEN_READ_GAP_MS, options.now)
    const read = () =>
      void Promise.all([
        options.readScreen(key, sessionId).catch(() => null),
        options.readTurnsFor([key]).catch(() => null),
      ])
    const release = watchScreen(key, sessionId, (event) => {
      if (event === 'output') return throttle.schedule(read)
      throttle.cancel()
      readEnd(key)
    })
    // No pane to watch: it exited before the wait armed, or the key has none this session owns.
    if (!release) readEnd(key)
    return () => {
      throttle.cancel()
      release?.()
    }
  })
  return () => {
    for (const release of releases) release()
  }
}

/**
 * The fallback for a host without pane events: re-read the waited panes and logs on a timer. Slower
 * than a screen redraw and far faster than a human notices — the point is to observe a transition,
 * not to animate one. The logs are read too, as a backstop for a log the watch could not arm.
 */
function pollScreens(options: WaitPollOptions, sessionId: string | null): () => void {
  const { request } = options
  const timer = setInterval(() => {
    void Promise.all([
      ...(options.hasTerminalRead()
        ? request.keys.map((key) => options.readScreen(key, sessionId).catch(() => null))
        : []),
      options.readTurnsFor(request.keys).catch(() => null),
    ])
  }, WAIT_POLL_MS)
  options.timers().add(timer as unknown as ReturnType<typeof setTimeout>)
  return () => {
    clearInterval(timer)
    options.timers().delete(timer as unknown as ReturnType<typeof setTimeout>)
  }
}
