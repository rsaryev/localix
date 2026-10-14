import { useEffect, useRef, type RefObject } from 'react'
import { backendClient } from '@/shared/api/client'
import { eventSocket } from '@/shared/api/eventSocket'

export function useFileConnectionRecovery(
  visible: boolean,
  sessionId: string | null,
  editPath: string,
  buffer: RefObject<string>,
  retry: () => void,
  reconcile: () => Promise<void>,
) {
  const failedConnection = useRef(false)
  useEffect(() => {
    if (!visible) return
    const connected = eventSocket.onConnected(() => {
      if (failedConnection.current) {
        failedConnection.current = false
        retry()
      }
    })
    const reconnected = eventSocket.onReconnect(() => {
      if (!sessionId || !editPath) return
      // Restart loses the LSP document and file events. Reopen the live buffer
      // and check disk using the editor's existing dirty-buffer conflict policy.
      void backendClient.lspOpen(sessionId, editPath, buffer.current)
      void reconcile()
    })
    return () => {
      connected()
      reconnected()
    }
  }, [visible, sessionId, editPath, buffer, retry, reconcile])
  return failedConnection
}
