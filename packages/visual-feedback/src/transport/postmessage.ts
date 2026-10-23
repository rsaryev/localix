/**
 * postMessage transport (probe side). The probe self-generates a channelId,
 * announces it in the `ready` handshake, and stamps every outgoing message with
 * it. Incoming host messages are accepted only when their channel matches and the
 * source is the parent window. targetOrigin is `'*'` because the preview is served
 * from an ephemeral-port origin the host can't predict (trust is by source, not
 * origin — mirrors the mini app panel bridge).
 */

import { VF_BRIDGE_KEY, type VfHostMessage, type VfProbeMessage } from '../protocol/index'

export interface ProbeTransport {
  send(msg: VfProbeMessage): void
  onHost(handler: (msg: VfHostMessage) => void): () => void
  channelId: string
  destroy(): void
}

function genChannelId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return `vf_${c.randomUUID()}`
  return `vf_${Math.floor(performance.now())}_${Math.floor(performance.timeOrigin)}`
}

export function createProbeTransport(target: Window = window.parent): ProbeTransport {
  const channelId = genChannelId()
  const handlers = new Set<(msg: VfHostMessage) => void>()

  const onMessage = (e: MessageEvent) => {
    const data = e.data as (VfHostMessage & { [VF_BRIDGE_KEY]?: string }) | null
    if (!data || data[VF_BRIDGE_KEY] !== channelId) return
    // Host is the parent window; ignore anything else.
    if (e.source !== target) return
    for (const h of handlers) {
      try {
        h(data)
      } catch {
        /* never let a handler break the loop */
      }
    }
  }
  window.addEventListener('message', onMessage)

  return {
    channelId,
    send(msg) {
      try {
        target.postMessage({ ...msg, [VF_BRIDGE_KEY]: channelId }, '*')
      } catch {
        /* parent gone */
      }
    },
    onHost(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    destroy() {
      window.removeEventListener('message', onMessage)
      handlers.clear()
    },
  }
}
