/**
 * DNS rebinding: a page whose name re-resolves to 127.0.0.1 reaches a loopback listener with its
 * OWN name in `Host`. Both preview listeners must refuse such a request, as the API guard does.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { tempDirPerTest } from '@localixai/testing'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildInjectedPreviewUrl, disposeProxyServers } from './preview-proxy'
import { disposeStaticServers, ensureStaticServer } from './preview-static'

const dir = tempDirPerTest('localix-preview-host')

afterEach(() => {
  disposeStaticServers()
  disposeProxyServers()
})

describe('preview listeners and the Host header', () => {
  test('the static server refuses a rebound Host and serves a loopback one', async () => {
    writeFileSync(join(dir(), 'secret.txt'), 'dummy-secret')
    const port = ensureStaticServer(dir())
    const rebound = await fetch(`http://127.0.0.1:${port}/secret.txt`, {
      headers: { host: `attacker.example:${port}` },
    })
    expect(rebound.status).toBe(403)
    expect(await rebound.text()).not.toContain('dummy-secret')
    const local = await fetch(`http://127.0.0.1:${port}/secret.txt`)
    expect(local.status).toBe(200)
    expect(await local.text()).toBe('dummy-secret')
  })

  test('the proxy refuses a rebound Host for requests and upgrades', async () => {
    const hosts: string[] = []
    const upstream = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req) {
        hosts.push(req.headers.get('host') ?? '')
        return new Response('dummy-upstream')
      },
    })
    try {
      const injectUrl = buildInjectedPreviewUrl(`http://127.0.0.1:${upstream.port}/`)!
      const port = new URL(injectUrl).port
      const rebound = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { host: `attacker.example:${port}` },
      })
      expect(rebound.status).toBe(403)
      const upgrade = await fetch(`http://127.0.0.1:${port}/hmr`, {
        headers: {
          host: `attacker.example:${port}`,
          upgrade: 'websocket',
          connection: 'Upgrade',
          'sec-websocket-version': '13',
          'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        },
      })
      expect(upgrade.status).toBe(403)
      expect(hosts).toEqual([])
      const local = await fetch(injectUrl)
      expect(local.status).toBe(200)
      expect(await local.text()).toBe('dummy-upstream')
    } finally {
      await upstream.stop(true)
    }
  })
})
