import { expect, test } from 'bun:test'
import { listenOnStablePort } from './preview-proxy-listen'

test('the injecting proxy is only ever bound to a loopback address', () => {
  // `Bun.serve` binds `0.0.0.0` without a hostname, which would put the person's dev server on the
  // LAN. A loopback fetch cannot tell the two apart, so every address the proxy binds is observed.
  const bound: string[] = []
  const serve = (hostname: string, port: number) => {
    bound.push(hostname)
    return Bun.serve({ port, hostname, fetch: () => new Response(null) })
  }
  const listeners = [
    listenOnStablePort('http://localhost:3999', 'localhost', serve),
    listenOnStablePort('http://127.0.0.1:3999', '127.0.0.1', serve),
  ]
  for (const listener of listeners) void listener.stop(true)
  expect(bound.length).toBeGreaterThan(0)
  expect(bound.every((h) => h === '127.0.0.1' || h === '::1')).toBe(true)
})
