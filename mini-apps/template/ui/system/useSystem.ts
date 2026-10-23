import { useEffect, useState } from 'react'
import { systemSnapshotSchema, type SystemSnapshot } from '../../shared/system'
import { usePolledSnapshot } from '../usePolledSnapshot'

/**
 * Polled on purpose. CPU and memory are gauges: they change continuously and no write announces
 * them, so a pushed sample would only move this timer into the backend. State that something
 * WRITES — a mark, a board — is heard instead, through `useStoreSnapshot` (see `SystemMarks.tsx`).
 */
export const SYSTEM_POLL_MS = 3000
/** Samples kept for the trend charts: 30 × 3s ≈ the last minute and a half. */
export const HISTORY_SIZE = 30

/** Live system snapshot plus the short in-memory history the charts draw. */
export function useSystem(active: boolean) {
  const state = usePolledSnapshot({
    path: '/rpc/template/system',
    schema: systemSnapshotSchema,
    intervalMs: SYSTEM_POLL_MS,
    active,
    failureMessage:
      'Cannot read system information. Check that the mini app backend is running, then retry.',
  })
  const [history, setHistory] = useState<SystemSnapshot[]>([])
  useEffect(() => {
    const next = state.snapshot
    if (!next) return
    // The backend caches reads for one second, so two polls can return the same
    // timestamped sample; keying on `capturedAt` keeps the chart from repeating a bar.
    setHistory((current) =>
      [...current.filter((item) => item.capturedAt !== next.capturedAt), next].slice(-HISTORY_SIZE),
    )
  }, [state.snapshot])
  return { ...state, history }
}
