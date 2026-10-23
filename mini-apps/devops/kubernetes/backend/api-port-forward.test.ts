import { describe, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:net'
import {
  describeListenFailure,
  forwardFailureScope,
  listenOnLoopback,
  readPortForwardErrorChunk,
} from './api-port-forward'

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

describe('loopback port-forward listener', () => {
  test('asks the OS for a concrete free port when localPort is automatic', async () => {
    const server = createServer()
    try {
      const port = await listenOnLoopback(server, 0)
      expect(port).toBeGreaterThan(0)
      expect(server.listening).toBe(true)
    } finally {
      await close(server)
    }
  })

  test('turns an occupied explicit port into a short actionable message', async () => {
    const blocker = createServer()
    const contender = createServer()
    try {
      const port = await listenOnLoopback(blocker, 0)
      let failure: unknown
      try {
        await listenOnLoopback(contender, port)
      } catch (error) {
        failure = error
      }
      expect(describeListenFailure(failure, port)).toBe(`Local port ${port} is already in use.`)
    } finally {
      await close(blocker)
    }
  })

  test('a stopped listener releases its concrete port for reuse', async () => {
    const first = createServer()
    const second = createServer()
    const port = await listenOnLoopback(first, 0)
    await close(first)
    try {
      expect(await listenOnLoopback(second, port)).toBe(port)
    } finally {
      await close(second)
    }
  })

  test('does not mistake the empty error-channel handshake for a tunnel failure', () => {
    expect(readPortForwardErrorChunk(Buffer.alloc(0))).toBeNull()
    expect(readPortForwardErrorChunk(Buffer.from('target port is not listening'))).toBe(
      'target port is not listening',
    )
  })

  test('once live, one failed connection ends that connection, not the forward', () => {
    // It used to close the listener and every other socket on the first stream error.
    expect(forwardFailureScope(true, true)).toBe('connection')
    // Before readiness a failure is the forward's own verdict (bad port, pod gone).
    expect(forwardFailureScope(false, true)).toBe('forward')
    expect(forwardFailureScope(true, false)).toBe('forward')
  })
})
