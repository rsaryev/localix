/**
 * The consumer's only clock: the wake after a write, and retries. A caught-up consumer arms
 * nothing: every notice is recorded in this process and its signal wakes the feed (`record.ts`).
 */
export interface ConsumerTimers {
  set: (run: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}
export const realTimers: ConsumerTimers = {
  set: (run, ms) => {
    const handle = setTimeout(run, ms)
    handle.unref?.()
    return handle
  },
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}
