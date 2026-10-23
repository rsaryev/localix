import { expect, test } from 'bun:test'
import {
  BACKSTOP_REPORT_MS,
  cameraBackstopMs,
  IDLE_POLL_MS,
  INDEXING_POLL_MS,
  snapshotPollMs,
} from './cadence'

/**
 * A build used to be polled every 1.5 s even with the stream live, though the stream carries its
 * end (`revision`) and now its progress (`indexing`). Only the socket being down brings it back.
 */
test('a live stream stops the build poll; a dropped one restores it', () => {
  expect(snapshotPollMs({ indexing: true, streamLive: true, changesLive: false })).toBeNull()
  expect(snapshotPollMs({ indexing: true, streamLive: true, changesLive: true })).toBeNull()
  expect(snapshotPollMs({ indexing: true, streamLive: false, changesLive: true })).toBe(
    INDEXING_POLL_MS,
  )
})

test('an idle map polls only when no live change signal reaches it', () => {
  expect(snapshotPollMs({ indexing: false, streamLive: true, changesLive: true })).toBeNull()
  // Without file changes, the read is what makes the backend check the disk.
  expect(snapshotPollMs({ indexing: false, streamLive: true, changesLive: false })).toBe(
    IDLE_POLL_MS,
  )
  expect(snapshotPollMs({ indexing: false, streamLive: false, changesLive: true })).toBe(
    IDLE_POLL_MS,
  )
})

/** The stream asks for a report when a tool needs one; the 8 s report is only its backstop. */
test('the camera backstop report runs only while the stream is down', () => {
  expect(cameraBackstopMs(true)).toBeNull()
  expect(cameraBackstopMs(false)).toBe(BACKSTOP_REPORT_MS)
})
