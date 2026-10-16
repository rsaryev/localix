import type { ClientOptions } from 'ws'
import type WebSocketClient from 'isomorphic-ws'
import { WebSocketHandler } from '@kubernetes/client-node/dist/web-socket-handler.js'
import type { KubeConfig } from '@kubernetes/client-node'

interface BunWebSocketOptions {
  protocols: string[]
  headers?: Record<string, string | string[] | undefined>
  tls: {
    ca?: unknown
    cert?: unknown
    key?: unknown
    rejectUnauthorized: boolean
    serverName?: string
  }
}

/** Make the client library's streaming APIs honor kubeconfig TLS under Bun. */
export function createBunWebSocketHandler(config: KubeConfig): WebSocketHandler {
  return new WebSocketHandler(config, (url, protocols, tlsOptions) => {
    const nodeTls = tlsOptions as ClientOptions & { servername?: string }
    const options: BunWebSocketOptions = {
      protocols,
      headers: tlsOptions.headers as Record<string, string | string[] | undefined> | undefined,
      tls: {
        ca: tlsOptions.ca,
        cert: tlsOptions.cert,
        key: tlsOptions.key,
        rejectUnauthorized: tlsOptions.rejectUnauthorized !== false,
        serverName: nodeTls.servername,
      },
    }
    const socket = new WebSocket(url, options as unknown as string[])
    socket.binaryType = 'nodebuffer' as BinaryType
    return socket as unknown as WebSocketClient
  })
}
