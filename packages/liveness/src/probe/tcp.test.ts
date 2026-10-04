/**
 * The probe against real sockets — the one part of this package that must be exercised on
 * the operating system it will run on, since "can I connect" is exactly the thing a fake
 * cannot prove. `node:net` is what makes the same code answer on macOS, Linux and Windows.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:net'
import { probeFor, probeTcp, tcpEndpointOf } from './index'

const never = new AbortController().signal

function listen(host: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      if (typeof address === 'string' || !address) {
        reject(new Error('no port'))
        return
      }
      resolve({ server, port: address.port })
    })
  })
}

const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()))

const servers: Server[] = []
afterAll(async () => {
  for (const server of servers) await close(server)
})

describe('tcp probe', () => {
  test('sees a listener, and sees it go away', async () => {
    const { server, port } = await listen('127.0.0.1')
    servers.push(server)

    expect(await probeTcp('127.0.0.1', port, 500, never)).toBe(true)

    await close(server)
    servers.pop()
    expect(await probeTcp('127.0.0.1', port, 500, never)).toBe(false)
  })

  test('finds a localhost server whichever address family it bound', async () => {
    // A dev server on ::1 is up even though 127.0.0.1 refuses, and vice versa. Probing one
    // family only is how a running server reads as dead on a machine configured the other way.
    const { server, port } = await listen('127.0.0.1')
    servers.push(server)

    expect(await probeTcp('localhost', port, 500, never)).toBe(true)
  })

  test('an aborted check answers "not available" instead of throwing', async () => {
    const aborted = AbortSignal.abort()
    expect(await probeTcp('127.0.0.1', 9, 500, aborted)).toBe(false)
  })

  test('reads the endpoint out of a url, defaulting the port by protocol', () => {
    expect(tcpEndpointOf('http://localhost:5173/app')).toEqual({ host: 'localhost', port: 5173 })
    expect(tcpEndpointOf('https://example.com')).toEqual({ host: 'example.com', port: 443 })
    expect(tcpEndpointOf('http://[::1]:8080/')).toEqual({ host: '::1', port: 8080 })
    expect(tcpEndpointOf('file:///tmp/index.html')).toBeNull()
    expect(tcpEndpointOf('not a url')).toBeNull()
  })

  test('a reported target has no probe — only its owner knows', () => {
    expect(probeFor({ kind: 'reported' }, 300)).toBeNull()
    expect(probeFor({ kind: 'url', url: 'http://localhost:1' }, 300)).not.toBeNull()
  })
})
