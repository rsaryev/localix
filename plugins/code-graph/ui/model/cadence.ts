/**
 * How often the tab asks for what the stream would otherwise tell it (`shared/stream.ts`).
 *
 * With the stream live, a build pushes its progress and its end, and the agent's camera asks for a
 * report when a tool needs one: neither is polled. What stays is the poll that IS the change
 * signal — without the workspace's file changes, only a snapshot read makes the backend check the
 * disk — and every cadence while the socket is down.
 */
export const INDEXING_POLL_MS = 1500
export const IDLE_POLL_MS = 8000
/**
 * The report a tool falls back to when the stream cannot ask (the socket is down): the backend
 * keeps a report for 10 s, so a visible tab refreshes it a little more often than that.
 */
export const BACKSTOP_REPORT_MS = 8000

export function snapshotPollMs({
  indexing,
  streamLive,
  changesLive,
}: {
  indexing: boolean
  streamLive: boolean
  changesLive: boolean
}): number | null {
  if (streamLive && (indexing || changesLive)) return null
  return indexing ? INDEXING_POLL_MS : IDLE_POLL_MS
}

export function cameraBackstopMs(streamLive: boolean): number | null {
  return streamLive ? null : BACKSTOP_REPORT_MS
}
