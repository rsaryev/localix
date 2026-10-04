/**
 * The portable liveness check: open a TCP connection and close it.
 *
 * It is deliberately NOT an HTTP request. A GET into somebody's dev server wakes an SSR
 * render, fills their request log, and can trip rate limits — every few seconds, forever,
 * for a question a connect already answers. A connect also needs no CORS, no headers, and
 * no response body.
 *
 * `node:net` is the reason this works the same on macOS, Linux and Windows, unlike the
 * `lsof` / `/proc` enumeration that OS-level port scanning needs.
 */
import { connect, type NetConnectOpts } from 'node:net'

/** localhost is two addresses. A server bound to only one of them is still up. */
const LOOPBACK_ALIASES = ['127.0.0.1', '::1']

function connectOnce(
  options: NetConnectOpts,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false)
      return
    }
    const socket = connect(options)
    const settle = (alive: boolean) => {
      signal.removeEventListener('abort', onAbort)
      socket.removeAllListeners()
      socket.destroy()
      resolve(alive)
    }
    function onAbort() {
      settle(false)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => settle(true))
    socket.once('error', () => settle(false))
    socket.once('timeout', () => settle(false))
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * True when something accepts a connection on host:port within the budget. A refusal, a
 * timeout, an unresolvable host and an aborted check all read as "not available" — this
 * answers one question and never throws.
 */
export async function probeTcp(
  host: string,
  port: number,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  const hosts = host === 'localhost' ? LOOPBACK_ALIASES : [host]
  // Raced, not tried in turn: a machine where one family is refused instantly and the other
  // is slow would otherwise pay both budgets, and the answer is "any of them accepted".
  const results = await Promise.all(
    hosts.map((candidate) => connectOnce({ host: candidate, port }, timeoutMs, signal)),
  )
  return results.some(Boolean)
}

/** True when a unix domain socket accepts a connection. POSIX only — Windows has no UDS path. */
export function probeUnixSocket(
  path: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  return connectOnce({ path }, timeoutMs, signal)
}
