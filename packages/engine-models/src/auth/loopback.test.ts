import { describe, expect, test } from 'bun:test'

import { askToFreePort, startCallbackServer } from './loopback'

const serve = () =>
  startCallbackServer({
    providerName: 'OpenAI',
    host: '127.0.0.1',
    port: 0,
    path: '/auth/callback',
    cancel: { path: '/cancel', message: 'Login cancelled by a newer login' },
    state: 's',
    complete: async (params) => params.get('code'),
    timeoutMs: 5_000,
  })

describe('the sign-in callback server', () => {
  test('redirects to 127.0.0.1, the address it listens on', async () => {
    const server = await serve()
    try {
      expect(server.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/)
    } finally {
      server.close()
    }
  })

  test('a web page cannot cancel a sign-in; a newer login asking over plain HTTP can', async () => {
    const server = await serve()
    const port = Number(new URL(server.redirectUri).port)
    try {
      // What a page loading this address sends: its origin and fetch metadata.
      const fromPage = await fetch(`http://127.0.0.1:${port}/cancel`, {
        headers: { origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' },
      })
      expect(fromPage.status).toBe(404)
      const waiting = server.wait()
      await askToFreePort(port)
      expect(await waiting.catch((error: Error) => error.message)).toBe(
        'Login cancelled by a newer login',
      )
    } finally {
      server.close()
    }
  })
})
