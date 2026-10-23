import { randomUUID } from 'node:crypto'
import { connect, createServer, type AddressInfo, type Server, type Socket } from 'node:net'
import { PassThrough, Writable } from 'node:stream'
import { createKubeConfig } from './api-internals'
import { createBunApiClient } from './api-http'
import { createBunWebSocketHandler } from './api-websocket'
import type { PortForward } from './contracts'
import { KubeError, mapKubeError } from './errors'
import { getKubernetesClient } from './kubernetes-client'

export interface StartPortForwardOptions {
  namespace: string
  pod: string
  localPort: number
  podPort: number
  context?: string
  owner?: string
}

interface ForwardEntry {
  meta: PortForward
  server: Server
  sockets: Set<Socket>
  tunnels: Set<{ close(): void }>
}

const LOOPBACK_HOST = '127.0.0.1'

/** Bind a loopback listener and return the port the OS actually assigned.
 *
 * `port: 0` is intentional: it is the race-free way to offer "Automatic" local
 * ports. Scanning for a free port and binding it later leaves a gap where another
 * process can claim it.
 */
export function listenOnLoopback(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      const address = server.address() as AddressInfo | null
      if (!address) {
        reject(new Error('The local listener did not report an address'))
        return
      }
      resolve(address.port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, LOOPBACK_HOST)
  })
}

/** Keep listener failures useful without exposing Bun/Node socket wording in the UI. */
export function describeListenFailure(error: unknown, requestedPort: number): string {
  const code =
    error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
  if (code === 'EADDRINUSE' && requestedPort > 0) {
    return `Local port ${requestedPort} is already in use.`
  }
  if (requestedPort === 0) return 'Could not choose a free local port.'
  return `Could not listen on local port ${requestedPort}.`
}

/** The first error-channel frame contains only the stripped port header. */
export function readPortForwardErrorChunk(chunk: { toString(): string }): string | null {
  const message = chunk.toString()
  return message.trim() ? message : null
}

/**
 * What one failure tears down.
 *
 * Every connection used to close the WHOLE forward on its first error, so once the forward was
 * live, one "connection refused" on one TCP stream dropped the listener and every other socket —
 * kubectl fails only that stream. Before readiness a failure is the forward's own verdict (bad
 * target port, pod gone); after it, a failure that belongs to one connection ends that connection.
 */
export function forwardFailureScope(
  readinessSettled: boolean,
  fromConnection: boolean,
): 'forward' | 'connection' {
  return readinessSettled && fromConnection ? 'connection' : 'forward'
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) return resolve()
    server.close(() => resolve())
  })
}

/** Local TCP listeners backed by Kubernetes' WebSocket port-forward subresource. */
export class ApiPortForwardRegistry {
  private readonly forwards = new Map<string, ForwardEntry>()
  private readonly ownerGenerations = new Map<string, number>()
  private readonly listeners = new Set<() => void>()

  /** Hear every change of {@link list}: a forward started, stopped, or closed by its tunnel. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private announce(): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener()
      } catch {
        // One follower's failure must not keep the others from hearing the change.
      }
    }
  }

  async start(options: StartPortForwardOptions): Promise<PortForward> {
    const ownerGeneration = options.owner
      ? (this.ownerGenerations.get(options.owner) ?? 0)
      : undefined
    const k8s = await getKubernetesClient()
    const config = await createKubeConfig(options.context)
    const core = await createBunApiClient(config, k8s.CoreV1Api)
    try {
      await core.readNamespacedPod({ name: options.pod, namespace: options.namespace })
    } catch (error) {
      throw new KubeError('port_forward_failed', mapKubeError(error).message, { cause: error })
    }
    if (options.owner && (this.ownerGenerations.get(options.owner) ?? 0) !== ownerGeneration) {
      throw new KubeError(
        'port_forward_failed',
        'The pod tab closed before the forward could start.',
      )
    }

    const sockets = new Set<Socket>()
    const tunnels = new Set<{ close(): void }>()
    const handler = createBunWebSocketHandler(config)
    const forwarder = new k8s.PortForward(config, true, handler)
    let entry: ForwardEntry | undefined
    let readinessSettled = false
    let resolveReadiness!: () => void
    let rejectReadiness!: (error: Error) => void
    const readiness = new Promise<void>((resolve, reject) => {
      resolveReadiness = resolve
      rejectReadiness = reject
    })
    const ready = () => {
      if (readinessSettled) return
      readinessSettled = true
      resolveReadiness()
    }
    const fail = (error: Error, connection?: Socket) => {
      if (forwardFailureScope(readinessSettled, connection !== undefined) === 'connection') {
        connection!.destroy()
        return
      }
      if (!readinessSettled) {
        readinessSettled = true
        rejectReadiness(error)
      }
      if (entry) void this.close(entry.meta.id, entry)
    }
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.on('error', () => undefined)
      socket.once('close', () => sockets.delete(socket))
      // Bun sockets may begin flowing as soon as the library adds its data listener.
      // Buffer eager client bytes until the Kubernetes websocket is connected.
      const input = new PassThrough()
      socket.pipe(input)
      let detail = ''
      const errors = new Writable({
        write(chunk, _encoding, done) {
          // The port-forward protocol opens every channel with a two-byte port
          // header. @kubernetes/client-node strips that header and writes the
          // remaining buffer to this stream even when it is empty. That empty
          // handshake frame means "error channel ready", not "tunnel rejected".
          const message = readPortForwardErrorChunk(chunk)
          if (message === null) {
            done()
            return
          }
          detail += message
          fail(new Error(detail.trim()), socket)
          done()
        },
      })
      void forwarder
        .portForward(options.namespace, options.pod, [options.podPort], socket, errors, input)
        .then((tunnel) => {
          const websocket = typeof tunnel === 'function' ? tunnel() : tunnel
          if (!websocket) return
          tunnels.add(websocket)
          // Opening the websocket is not enough: Kubernetes reports a bad target
          // port on the error channel just after the upgrade. A brief grace
          // period catches that before the UI calls the forward active.
          const readyTimer = setTimeout(ready, 100)
          websocket.addEventListener(
            'close',
            () => {
              clearTimeout(readyTimer)
              tunnels.delete(websocket)
              if (!readinessSettled) {
                fail(new Error(detail.trim() || 'The tunnel closed early.'), socket)
              }
              socket.destroy()
            },
            { once: true },
          )
          socket.once('close', () => websocket.close())
        })
        .catch((error) => {
          const message =
            detail.trim() ||
            (error && typeof error === 'object' && 'message' in error
              ? String(error.message)
              : String(error))
          const failure = new Error(message)
          fail(failure, socket)
          socket.destroy(failure)
        })
    })

    let localPort: number
    try {
      localPort = await listenOnLoopback(server, options.localPort)
    } catch (error) {
      throw new KubeError('port_forward_failed', describeListenFailure(error, options.localPort), {
        cause: error,
      })
    }

    // Validate the actual Kubernetes websocket before returning success. The
    // loopback listener alone only proves that a local port was free.
    const probe = connect({ host: LOOPBACK_HOST, port: localPort })
    probe.on('error', (error) => fail(error))
    let readinessTimer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        readiness,
        new Promise<never>((_, reject) => {
          readinessTimer = setTimeout(
            () => reject(new Error('Timed out while opening the Kubernetes tunnel.')),
            8_000,
          )
        }),
      ])
    } catch (error) {
      for (const socket of sockets) socket.destroy()
      for (const tunnel of tunnels) tunnel.close()
      await closeServer(server)
      throw new KubeError(
        'port_forward_failed',
        error instanceof Error ? error.message : 'Could not open the Kubernetes tunnel.',
        { cause: error },
      )
    } finally {
      if (readinessTimer) clearTimeout(readinessTimer)
      probe.destroy()
    }

    if (options.owner && (this.ownerGenerations.get(options.owner) ?? 0) !== ownerGeneration) {
      for (const socket of sockets) socket.destroy()
      for (const tunnel of tunnels) tunnel.close()
      await closeServer(server)
      throw new KubeError(
        'port_forward_failed',
        'The pod tab closed before the forward became ready.',
      )
    }

    const meta: PortForward = {
      id: randomUUID(),
      namespace: options.namespace,
      pod: options.pod,
      localPort,
      podPort: options.podPort,
      context: options.context ?? '',
      createdAt: new Date().toISOString(),
      owner: options.owner ?? '',
    }
    entry = { meta, server, sockets, tunnels }
    this.forwards.set(meta.id, entry)
    this.announce()
    return meta
  }

  private async close(id: string, entry: ForwardEntry): Promise<void> {
    // A tunnel failure and a stop can both close one entry; only the first changes the list.
    if (this.forwards.get(id) === entry) {
      this.forwards.delete(id)
      this.announce()
    }
    for (const socket of entry.sockets) socket.destroy()
    for (const tunnel of entry.tunnels) tunnel.close()
    await closeServer(entry.server)
  }

  async stop(id: string): Promise<void> {
    const entry = this.forwards.get(id)
    if (!entry) throw new KubeError('not_found', `No active port-forward ${id}`)
    await this.close(id, entry)
  }

  async stopByOwner(owner: string): Promise<number> {
    this.ownerGenerations.set(owner, (this.ownerGenerations.get(owner) ?? 0) + 1)
    const entries = [...this.forwards].filter(([, entry]) => entry.meta.owner === owner)
    await Promise.all(entries.map(([id, entry]) => this.close(id, entry)))
    return entries.length
  }

  list(): PortForward[] {
    return [...this.forwards.values()].map((entry) => entry.meta)
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.forwards].map(([id, entry]) => this.close(id, entry)))
  }
}
