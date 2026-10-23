import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { LOCALIX_CLIENT_HEADER } from './client-header'
import {
  createLocalOriginGuard,
  createLocalOriginPolicy,
  judgeRequest,
  normalizeOrigin,
  parseUiOrigins,
  type GuardedRequest,
} from './local-origin-guard'

const DEV_UI = 'http://localhost:5050'
const policy = createLocalOriginPolicy({ uiOrigins: [DEV_UI], platform: 'darwin' })

const req = (over: Partial<GuardedRequest> = {}): GuardedRequest => ({
  method: 'POST',
  host: '127.0.0.1:5051',
  origin: undefined,
  upgrade: undefined,
  clientHeader: undefined,
  contentType: undefined,
  ...over,
})

const verdictCode = (over: Partial<GuardedRequest>) => {
  const verdict = judgeRequest(policy, req(over))
  return verdict.ok ? 'ok' : verdict.code
}

describe('Host (DNS rebinding)', () => {
  test('accepts every loopback spelling, on any port', () => {
    for (const host of [
      '127.0.0.1:5051',
      'localhost:5051',
      '[::1]:5051',
      'LOCALHOST:1',
      '127.0.0.1',
    ]) {
      expect(verdictCode({ method: 'GET', host })).toBe('ok')
    }
  })

  test('rejects a rebound name, a lookalike, a userinfo trick and a missing Host', () => {
    for (const host of [
      'evil.example:5051',
      'localhost.evil.example:5051',
      '127.0.0.1.nip.io:5051',
      'evil.example@127.0.0.1:5051',
      '127.0.0.1:5051/x',
      '',
      undefined,
    ]) {
      expect(verdictCode({ method: 'GET', host })).toBe('forbidden_host')
    }
  })

  test('a concrete bind host is accepted by name; a wildcard bind adds nothing', () => {
    const lan = createLocalOriginPolicy({ bindHost: '192.168.1.20' })
    expect(lan.allowsHost('192.168.1.20:5051')).toBe(true)
    const wildcard = createLocalOriginPolicy({ bindHost: '0.0.0.0' })
    expect(wildcard.allowsHost('0.0.0.0:5051')).toBe(false)
    expect(wildcard.allowsHost('192.168.1.20:5051')).toBe(false)
    expect(createLocalOriginPolicy({ bindHost: '::1' }).allowsHost('[::1]:5051')).toBe(true)
  })
})

describe('Origin', () => {
  test('the packaged app, its plugin apps and the configured dev UI may write', () => {
    for (const origin of ['tauri://localhost', 'localix-app://app', DEV_UI]) {
      expect(verdictCode({ origin })).toBe('ok')
    }
  })

  test('tauri.localhost is the packaged page only on Windows', () => {
    const windows = createLocalOriginPolicy({ platform: 'win32' })
    for (const origin of ['http://tauri.localhost', 'https://tauri.localhost']) {
      expect(windows.allowsOrigin(origin, '127.0.0.1:5051')).toBe(true)
      for (const platform of ['darwin', 'linux'] as const) {
        expect(createLocalOriginPolicy({ platform }).allowsOrigin(origin, '127.0.0.1:5051')).toBe(
          false,
        )
      }
    }
    expect(windows.allowsOrigin('tauri://localhost', '127.0.0.1:5051')).toBe(true)
  })

  test('a foreign site, another loopback port (a preview server) and an opaque origin may not', () => {
    for (const origin of [
      'https://evil.example',
      'http://127.0.0.1:7777',
      'http://localhost:5173',
      'http://localhost:5050.evil.example',
      'null',
      '',
    ]) {
      expect(verdictCode({ origin })).toBe('forbidden_origin')
      // The client header does not launder a foreign Origin.
      expect(verdictCode({ origin, clientHeader: '1' })).toBe('forbidden_origin')
    }
  })

  test('the API origin is first-party only when the API serves the UI itself', () => {
    const served = createLocalOriginPolicy({ servesUi: true })
    expect(served.allowsOrigin('http://127.0.0.1:5051', '127.0.0.1:5051')).toBe(true)
    // A preview server on another port is a different origin even on the same host.
    expect(served.allowsOrigin('http://127.0.0.1:7777', '127.0.0.1:5051')).toBe(false)
    expect(policy.allowsOrigin('http://127.0.0.1:5051', '127.0.0.1:5051')).toBe(false)
  })

  test('reads stay open to any origin — CORS keeps the answer from a foreign page', () => {
    expect(verdictCode({ method: 'GET', origin: 'https://evil.example' })).toBe('ok')
    expect(verdictCode({ method: 'HEAD', origin: 'https://evil.example' })).toBe('ok')
  })
})

describe('websocket upgrade', () => {
  const upgrade = 'websocket'

  test('a foreign page is refused before the upgrade', () => {
    for (const origin of ['https://evil.example', 'http://127.0.0.1:7777', 'null']) {
      expect(verdictCode({ method: 'GET', upgrade, origin })).toBe('forbidden_origin')
    }
  })

  test('the app pages and non-browser clients (no Origin) connect', () => {
    expect(verdictCode({ method: 'GET', upgrade, origin: 'tauri://localhost' })).toBe('ok')
    expect(verdictCode({ method: 'GET', upgrade, origin: DEV_UI })).toBe('ok')
    expect(verdictCode({ method: 'GET', upgrade })).toBe('ok')
  })

  test('the Host check applies to the handshake too', () => {
    expect(verdictCode({ method: 'GET', upgrade, host: 'evil.example:5051' })).toBe(
      'forbidden_host',
    )
  })
})

describe('writes without an Origin', () => {
  test('a body-less or form-shaped write needs the client header', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(verdictCode({ method })).toBe('client_header_required')
    }
    for (const contentType of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'TEXT/PLAIN;charset=utf-8',
    ]) {
      expect(verdictCode({ contentType })).toBe('client_header_required')
    }
  })

  test('the header, or a content type no page can send unpreflighted, admits it', () => {
    expect(verdictCode({ method: 'DELETE', clientHeader: '1' })).toBe('ok')
    // The documented `curl` webhook call: JSON, no Origin, no header.
    expect(verdictCode({ contentType: 'application/json' })).toBe('ok')
    expect(verdictCode({ contentType: 'application/octet-stream' })).toBe('ok')
  })

  test('a blank header value does not count', () => {
    expect(verdictCode({ clientHeader: '  ' })).toBe('client_header_required')
  })

  test('a preflight without Origin is answered by CORS, not refused', () => {
    expect(verdictCode({ method: 'OPTIONS' })).toBe('ok')
  })
})

describe('configured origins', () => {
  test('normalizes exact origins', () => {
    expect(normalizeOrigin(' http://localhost:5050/ ')).toBe('http://localhost:5050')
    expect(parseUiOrigins('http://localhost:5050, http://127.0.0.1:5050')).toEqual([
      'http://localhost:5050',
      'http://127.0.0.1:5050',
    ])
    expect(parseUiOrigins('  ')).toEqual([])
  })

  test('refuses anything that is not one exact http(s) origin', () => {
    for (const bad of [
      'localhost:5050',
      'http://localhost:*',
      'http://localhost:5050/app',
      'file:///x',
      '*',
    ]) {
      expect(() => normalizeOrigin(bad)).toThrow()
    }
  })
})

describe('middleware', () => {
  const app = new Hono()
  app.use('*', createLocalOriginGuard(policy))
  app.post('/rpc/x', (c) => c.json({ ok: true }))

  test('answers 403 with the verdict code, before the route runs', async () => {
    const res = await app.request('http://127.0.0.1:5051/rpc/x', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden_origin')
  })

  test('falls back to the URL host when the request carries no Host header', async () => {
    const res = await app.request('http://localhost/rpc/x', {
      method: 'POST',
      headers: { [LOCALIX_CLIENT_HEADER]: '1' },
    })
    expect(res.status).toBe(200)
    const rebound = await app.request('http://evil.example/rpc/x', {
      method: 'POST',
      headers: { [LOCALIX_CLIENT_HEADER]: '1' },
    })
    expect(rebound.status).toBe(403)
  })
})
