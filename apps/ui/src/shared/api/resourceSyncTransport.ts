import { eventSocket } from './eventSocket'
import { resourceSync } from './resourceSync'

type Socket = Pick<
  typeof eventSocket,
  | 'onConnected'
  | 'onDisconnect'
  | 'onSessionEvent'
  | 'onResyncRequired'
  | 'isConnected'
  | 'resumedWithReplay'
>
type Sync = Pick<typeof resourceSync, 'connected' | 'disconnected' | 'invalidate'>

/**
 * The existing socket/cursor/replay remains the only delivery channel. A reconnect that resumed
 * from its cursor replays the missed `resources.changed` frames, so the scheduler re-reads only
 * what the outage interrupted; any other open, or a replay found incomplete, reads everything.
 */
export function startResourceSyncTransport(
  socket: Socket = eventSocket,
  sync: Sync = resourceSync,
): () => void {
  const opened = () => sync.connected({ replayed: socket.resumedWithReplay() })
  const offConnected = socket.onConnected(opened)
  const offDisconnected = socket.onDisconnect(() => sync.disconnected())
  const offResync = socket.onResyncRequired(() => sync.connected())
  const offEvent = socket.onSessionEvent((_id, event) => {
    if (event.type === 'resources.changed') sync.invalidate(event.resources)
    if (event.type === 'session.updated' || event.type === 'child_session.updated')
      sync.invalidate(['sessions'], false)
    if (event.type === 'session.deleted') {
      sync.invalidate(['sessions'], false)
      sync.invalidate(['storage'])
    }
  })
  if (socket.isConnected()) opened()
  return () => {
    offEvent()
    offResync()
    offConnected()
    offDisconnected()
    sync.disconnected()
  }
}
