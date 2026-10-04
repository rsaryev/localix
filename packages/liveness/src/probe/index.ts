import type { LivenessTarget, Probe } from '../types'
import { probeTcp, probeUnixSocket } from './tcp'

export { probeTcp, probeUnixSocket } from './tcp'

const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443, 'ws:': 80, 'wss:': 443 }

/** The host:port a URL is served from, or null when it names no reachable endpoint. */
export function tcpEndpointOf(url: string): { host: string; port: number } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : DEFAULT_PORTS[parsed.protocol]
  if (!port || !Number.isInteger(port) || port < 1 || port > 65_535) return null
  // A bracketed IPv6 hostname reaches `net.connect` without its brackets.
  const host = parsed.hostname.replace(/^\[|\]$/gu, '')
  return host ? { host, port } : null
}

/**
 * Ask an endpoint whether it answers, over HTTP rather than TCP. Reserved for the case a
 * connect cannot decide: a proxy or tunnel that accepts connections while the app behind it
 * is gone. Any response at all — including 404 or 502 — proves something is serving.
 */
async function probeHttp(url: string, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    })
    void response.body?.cancel().catch(() => {})
    return true
  } catch {
    return false
  }
}

/**
 * Turn a described target into the check that answers it. A `reported` target has no probe:
 * its owner is the only one who knows (see the registry's `report`).
 */
export function probeFor(target: LivenessTarget, timeoutMs: number): Probe | null {
  switch (target.kind) {
    case 'tcp':
      return (signal) => probeTcp(target.host, target.port, timeoutMs, signal)
    case 'unix':
      return (signal) => probeUnixSocket(target.path, timeoutMs, signal)
    case 'url': {
      if (target.expectResponse) return (signal) => probeHttp(target.url, timeoutMs, signal)
      const endpoint = tcpEndpointOf(target.url)
      if (!endpoint) return null
      return (signal) => probeTcp(endpoint.host, endpoint.port, timeoutMs, signal)
    }
    case 'custom':
      return target.probe
    case 'reported':
      return null
  }
}
