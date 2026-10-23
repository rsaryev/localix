import { useEffect, useRef } from 'react'

/**
 * Run `read` while the surface is visible, but only when `key` differs from the key of the last
 * read that COMPLETED.
 *
 * The defect it prevents: keyed on visibility alone, every re-show of a tab re-read its data —
 * for the PR list a `gh` CLI round trip per tab switch, for the log a `git log` — although
 * nothing it depends on had changed. Marking a key read only when `done()` is called (the
 * result was applied) keeps a read cancelled mid-flight by a hide from counting as fresh.
 *
 * `read` receives `done` and may return a cleanup, which runs when the key or visibility changes.
 */
export function useReadWhenStale(
  visible: boolean,
  key: string,
  read: (done: () => void) => void | (() => void),
): void {
  const lastRead = useRef<string | null>(null)
  useEffect(() => {
    if (!visible || lastRead.current === key) return
    return read(() => {
      lastRead.current = key
    })
  }, [visible, key, read])
}
