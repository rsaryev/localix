import { useEffect, useRef } from 'react'
import { createRealtimeFeed, useRealtimeFeed } from '@localixai/plugin-sdk/ui/realtime-feed'

import {
  HISTORY_FRAME_TAG,
  HISTORY_SUBSCRIBE,
  HISTORY_UNSUBSCRIBE,
  parseHistoryFrame,
  type HistoryFrame,
} from '@localixai/api/external-agent-history-stream'

/**
 * The panel's side of the roster's live stream (`shared/history-stream.ts`).
 *
 * One key of the SDK's feed, however many rosters are open. `live` is the backend's own word that
 * its watch is armed, dropped the moment the socket goes down: frames sent while it was down are
 * gone, so a reconnect re-subscribes and every follower re-reads once.
 */
export const HISTORY = 'history'

export const historyFeed = createRealtimeFeed<string, HistoryFrame>({
  tag: HISTORY_FRAME_TAG,
  subscribe: () => ({ t: HISTORY_SUBSCRIBE }),
  unsubscribe: () => ({ t: HISTORY_UNSUBSCRIBE }),
  decode: parseHistoryFrame,
  status: (frame) => ('live' in frame ? frame.live : undefined),
})

/**
 * Re-read when history moves, while `enabled`. Returns whether changes are being pushed, which is
 * what lets the panel's timer fall back to a backstop. Re-enabling (a tab shown again) re-reads
 * once, since nothing was followed while it was hidden.
 */
export function useHistoryStream(enabled: boolean, onChange: () => void): boolean {
  const latest = useRef(onChange)
  const followed = useRef(false)
  useEffect(() => {
    latest.current = onChange
  })
  useEffect(() => {
    if (!enabled) return
    if (followed.current) latest.current()
    followed.current = true
  }, [enabled])
  return useRealtimeFeed(historyFeed, enabled ? HISTORY : null, {
    // A window behind another application is not reading: its focus refresh catches up.
    frame: () => {
      if (globalThis.document?.visibilityState !== 'hidden') onChange()
    },
    reconnect: onChange,
  })
}
