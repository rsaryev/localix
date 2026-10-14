import type { WaitRequest } from './waiters'
import { watchFiles, type WatchPath } from './history-watch'

/** How often a wait re-reads the panes and logs it is waiting on. */
const WAIT_POLL_MS = 2_000

interface WaitPollOptions {
  readonly request: WaitRequest
  readonly sessionId?: string | null
  readonly hasTerminalRead: () => boolean
  readonly readScreen: (key: string, sessionId: string | null) => Promise<string | null>
  readonly readTurnsFor: (keys: readonly string[]) => Promise<void>
  readonly timers: () => Set<ReturnType<typeof setTimeout>>
  readonly sourcePath: (key: string) => string | undefined
  readonly watchPath: () => WatchPath
}

/** Arm both readers synchronously; release the file watch before retiring the interval. */
export function startWaitPoll(options: WaitPollOptions): () => void {
  const { request, sessionId } = options
  // Slower than a screen redraw and far faster than a human notices: the point is to observe a
  // transition, not to animate one. Each tick is a VT render of panes already in memory, plus the
  // tail of each waited log — a screen that says nothing and a file that does must both be read.
  const timer = setInterval(() => {
    void Promise.all([
      ...(options.hasTerminalRead()
        ? request.keys.map((key) => options.readScreen(key, sessionId ?? null).catch(() => null))
        : []),
      options.readTurnsFor(request.keys).catch(() => null),
    ])
  }, WAIT_POLL_MS)
  options.timers().add(timer as unknown as ReturnType<typeof setTimeout>)
  // A log has a change event; the tick alone noticed a finished turn up to WAIT_POLL_MS late.
  // The screen has none (it is the host's in-memory pane), so the tick stays for it.
  const logs = new Set(request.keys.flatMap((key) => options.sourcePath(key) ?? []))
  const unwatch = watchFiles(
    [...logs],
    () => void options.readTurnsFor(request.keys).catch(() => null),
    { watchPath: options.watchPath() },
  )
  return () => {
    unwatch()
    clearInterval(timer)
    options.timers().delete(timer as unknown as ReturnType<typeof setTimeout>)
  }
}
