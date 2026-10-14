import { eventSocket } from './eventSocket'
import { resourceSync } from './resourceSync'

/** The existing socket/cursor/replay remains the only delivery channel. */
export function startResourceSyncTransport(): () => void {
  const offConnected = eventSocket.onConnected(() => resourceSync.connected())
  const offDisconnected = eventSocket.onDisconnect(() => resourceSync.disconnected())
  const offEvent = eventSocket.onSessionEvent((_id, event) => {
    if (event.type === 'resources.changed') resourceSync.invalidate(event.resources)
    if (event.type === 'session.updated' || event.type === 'child_session.updated')
      resourceSync.invalidate(['sessions'], false)
    if (event.type === 'session.deleted') {
      resourceSync.invalidate(['sessions'], false)
      resourceSync.invalidate(['storage'])
    }
  })
  if (eventSocket.isConnected()) resourceSync.connected()
  return () => {
    offEvent()
    offConnected()
    offDisconnected()
    resourceSync.disconnected()
  }
}
