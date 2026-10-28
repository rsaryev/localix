import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

const SUBPROTOCOL = 'mcp'

/**
 * The MCP WebSocket client transport, with request headers on the upgrade. The SDK's own
 * transport builds the socket from a URL alone; Bun's `WebSocket` also takes `headers`, which is
 * how a Claude Code `ws` server's `headers` (a bearer token, an API key) reach the server.
 */
export class HeadersWebSocketTransport implements Transport {
  private socket?: WebSocket
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  private readonly url: URL
  private readonly headers: Record<string, string>

  constructor(url: URL, headers: Record<string, string> = {}) {
    this.url = url
    this.headers = headers
  }

  start(): Promise<void> {
    if (this.socket) throw new Error('WebSocket transport already started')
    return new Promise((resolve, reject) => {
      // `headers` is Bun's extension of the second argument.
      const socket = new WebSocket(this.url, {
        protocols: [SUBPROTOCOL],
        headers: this.headers,
      } as unknown as string[])
      this.socket = socket
      socket.onerror = (event) => {
        const error =
          'error' in event && event.error instanceof Error
            ? event.error
            : new Error('WebSocket error')
        reject(error)
        this.onerror?.(error)
      }
      socket.onopen = () => resolve()
      socket.onclose = () => this.onclose?.()
      socket.onmessage = (event) => {
        try {
          this.onmessage?.(JSONRPCMessageSchema.parse(JSON.parse(String(event.data))))
        } catch (error) {
          this.onerror?.(error instanceof Error ? error : new Error(String(error)))
        }
      }
    })
  }

  async close(): Promise<void> {
    this.socket?.close()
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.socket) throw new Error('Not connected')
    this.socket.send(JSON.stringify(message))
  }
}
