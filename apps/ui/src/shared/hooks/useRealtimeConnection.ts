import { useEffect, useState } from 'react'
import { eventSocket } from '@/shared/api/eventSocket'

/**
 * How long the socket may be down before the UI says so.
 *
 * `eventSocket` reconnects on a 1s→8s backoff, so an ordinary blip is over well
 * inside this window and must not flicker an indicator. Only an outage that
 * outlasts the first couple of attempts is worth a user's attention.
 */
export const RECONNECTING_GRACE_MS = 3_000

export type RealtimeConnection = 'live' | 'reconnecting'

/**
 * Whether live events are actually flowing.
 *
 * `eventSocket` has published `onDisconnect`/`onConnected` all along with NOTHING
 * consuming either, so a sustained outage looked exactly like an idle app: the
 * transcript, the session roster and every plugin surface simply stopped
 * updating, with no way to tell "nothing is happening" from "nothing is
 * arriving". The run watchdog rescues a stalled agent run from the DB, but that
 * is recovery, not feedback.
 *
 * Reported as a status-bar state (`connected | reconnecting | disconnected`)
 * rather than a banner.
 */
export function useRealtimeConnection(
  /** Policy override for deterministic hosts/tests; application callers use the shared default. */
  graceMs = RECONNECTING_GRACE_MS,
): RealtimeConnection {
  const [state, setState] = useState<RealtimeConnection>('live')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const offDisconnect = eventSocket.onDisconnect(() => {
      // Arm once: a repeated drop while already waiting must not restart the
      // grace period, or a flapping connection would never report anything.
      timer ??= setTimeout(() => setState('reconnecting'), Math.max(0, graceMs))
    })
    const offConnected = eventSocket.onConnected(() => {
      clearTimeout(timer)
      timer = undefined
      setState('live')
    })
    return () => {
      clearTimeout(timer)
      offDisconnect()
      offConnected()
    }
  }, [graceMs])

  return state
}
