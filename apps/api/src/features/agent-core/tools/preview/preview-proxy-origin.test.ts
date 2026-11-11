/**
 * The preview proxy re-hosts a person's own app on another port so the Visual Feedback probe can be
 * injected. These tests drive a strict app (own-origin CSRF check, `HttpOnly` session cookie, OAuth
 * + PKCE against a provider on another port) through it, as a browser would, and hold the proxy to
 * one rule: a page it serves is the app's own page, and nothing else is.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createBrowserClient } from '../../../../testing/preview-browser-client'
import {
  startPreviewAppFixture,
  type PreviewAppFixture,
} from '../../../../testing/preview-app-fixture'
import { buildInjectedPreviewUrl, disposeProxyServers } from './preview-proxy'
import { preferredProxyPorts } from './preview-proxy-listen'

let fx: PreviewAppFixture
beforeEach(() => {
  fx = startPreviewAppFixture()
})
afterEach(async () => {
  disposeProxyServers()
  await fx.stop()
})

const proxied = () => new URL(buildInjectedPreviewUrl(`${fx.appOrigin}/`)!).origin

/** Sign in through the preview: the flow a person clicks through in the framed page. */
async function signIn(browser: ReturnType<typeof createBrowserClient>, proxy: string) {
  const authorize = await browser.navigate(`${proxy}/login`, { from: `${proxy}/` })
  expect(authorize.url.startsWith(`${fx.idpOrigin}/authorize?`)).toBe(true)
  expect(authorize.text).toContain('Identity provider')
  const fields = Object.fromEntries(new URL(authorize.url).searchParams)
  return browser.navigate(`${fx.idpOrigin}/authorize`, {
    form: { ...fields, user: 'ada' },
    from: authorize.url,
  })
}

describe('a page served by the preview proxy is the app’s own page', () => {
  test('a form saved from the proxied page passes the app’s own-origin check and reads back', async () => {
    const browser = createBrowserClient()
    const proxy = proxied()
    await signIn(browser, proxy)

    const saved = await browser.navigate(`${proxy}/settings`, {
      form: { theme: 'dark' },
      from: `${proxy}/settings`,
    })
    expect(saved.status).toBe(200)
    expect(saved.url).toBe(`${proxy}/settings`)
    expect(saved.text).toContain('Saved')
    expect(saved.text).toContain('Theme: dark')

    const post = fx.requests.find((r) => r.method === 'POST' && r.path === '/settings')!
    expect(post.origin).toBe(fx.appOrigin)
    expect(post.host).toBe(new URL(fx.appOrigin).host)
    expect(post.referer).toBe(`${fx.appOrigin}/settings`)

    const api = await browser.fetch(`${proxy}/api/settings`, {
      json: { theme: 'light' },
      from: `${proxy}/settings`,
    })
    expect(api.status).toBe(200)
    expect(await (await browser.fetch(`${proxy}/api/settings`)).json()).toEqual({ theme: 'light' })
  })

  test('a request from any other origin reaches the app with that origin, and is refused', async () => {
    const browser = createBrowserClient()
    const proxy = proxied()
    await signIn(browser, proxy)
    for (const foreign of ['https://attacker.example', 'http://localhost:1', 'null']) {
      const res = await fetch(`${proxy}/api/settings`, {
        method: 'POST',
        headers: { origin: foreign, 'content-type': 'application/json' },
        body: JSON.stringify({ theme: 'pwned' }),
      })
      expect(res.status).toBe(403)
      expect(fx.requests.at(-1)!.origin).toBe(foreign)
    }
  })

  test('a cookie set on a redirect reaches the browser with its attributes intact', async () => {
    const browser = createBrowserClient()
    const proxy = proxied()
    await signIn(browser, proxy)
    const res = await browser.fetch(`${proxy}/settings`, {
      form: { theme: 'dark' },
      from: `${proxy}/settings`,
    })
    expect(res.status).toBe(303)
    expect(res.headers.getSetCookie()).toEqual(['flash=saved; Path=/; HttpOnly; SameSite=Lax'])
    expect(browser.cookieNames('localhost').sort()).toEqual(['flash', 'sid'])
  })

  test('OAuth + PKCE completes, and the session it sets is the proxied page’s session', async () => {
    const browser = createBrowserClient()
    const proxy = proxied()
    const back = await signIn(browser, proxy)
    // The provider sends the person to the registered (real) origin; the state and verifier cookie
    // the proxied page set is the app's cookie there, because cookies belong to the host name.
    expect(back.status).toBe(200)
    expect(back.text).toContain('Signed in as ada')
    const home = await browser.navigate(`${proxy}/`)
    expect(home.text).toContain('Signed in as ada')
    // The provider never saw the proxy: no request of the flow was re-hosted on it.
    expect(fx.requests.filter((r) => r.server === 'idp').map((r) => r.host)).toEqual([
      new URL(fx.idpOrigin).host,
      new URL(fx.idpOrigin).host,
      new URL(fx.idpOrigin).host,
    ])
  })
})

describe('redirects', () => {
  test('a redirect to another origin keeps its Location; a relative one keeps its form', async () => {
    const proxy = proxied()
    const toProvider = await fetch(`${proxy}/login`, { redirect: 'manual' })
    expect(toProvider.status).toBe(302)
    expect(toProvider.headers.get('location')!.startsWith(`${fx.idpOrigin}/authorize?`)).toBe(true)
    const relative = await fetch(`${proxy}/app`, { redirect: 'manual' })
    expect(relative.status).toBe(301)
    expect(relative.headers.get('location')).toBe('/app/')
    const external = await fetch(`${proxy}/external`, { redirect: 'manual' })
    expect(external.headers.get('location')).toBe(`${fx.externalOrigin}/landing`)
  })

  test('an absolute redirect to the app’s own origin is mapped onto the proxy', async () => {
    const browser = createBrowserClient()
    const proxy = proxied()
    const authorize = await browser.navigate(`${proxy}/login`)
    const fields = Object.fromEntries(new URL(authorize.url).searchParams)
    const allow = await browser.fetch(`${fx.idpOrigin}/authorize`, {
      form: { ...fields, user: 'ada' },
      from: authorize.url,
    })
    const callback = new URL(allow.headers.get('location')!)
    // The callback, opened on the proxy, redirects to `${appOrigin}/`: the browser stays here.
    const res = await browser.fetch(`${proxy}${callback.pathname}${callback.search}`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${proxy}/`)
  })

  test('a redirect to another site is handed to the browser, never fetched by the proxy', async () => {
    const browser = createBrowserClient()
    const proxy = proxied()
    const visit = await browser.navigate(`${proxy}/external`)
    expect(visit.hops).toEqual([`${proxy}/external`, `${fx.externalOrigin}/landing`])
    expect(visit.text).toContain('External site')
    // The one request the external site got came from the browser, with its own Host.
    expect(fx.requests.filter((r) => r.server === 'external').map((r) => r.host)).toEqual([
      new URL(fx.externalOrigin).host,
    ])
  })

  test('a trailing-slash redirect lands the document where its relative script resolves', async () => {
    const browser = createBrowserClient()
    const proxy = proxied()
    const visit = await browser.navigate(`${proxy}/app`)
    expect(visit.url).toBe(`${proxy}/app/`)
    const script = new URL('./main.js', visit.url).href
    expect((await browser.fetch(script)).status).toBe(200)
  })
})

describe('the proxy’s origin', () => {
  test('is the same after a restart, so the page keeps its storage', () => {
    const first = buildInjectedPreviewUrl(`${fx.appOrigin}/settings`)
    disposeProxyServers()
    expect(buildInjectedPreviewUrl(`${fx.appOrigin}/settings`)).toBe(first)
  })

  test('uses the app’s host name, so the app’s cookies apply on any port the proxy gets', async () => {
    const browser = createBrowserClient()
    await signIn(browser, proxied())
    disposeProxyServers()
    // Something else took the preferred port: the proxy moves, the session does not.
    const squatter = Bun.serve({
      port: preferredProxyPorts(fx.appOrigin)[0],
      hostname: '127.0.0.1',
      fetch: () => new Response('squatter'),
    })
    try {
      const moved = proxied()
      expect(new URL(moved).port).not.toBe(String(squatter.port))
      expect(new URL(moved).hostname).toBe('localhost')
      expect((await browser.navigate(`${moved}/`)).text).toContain('Signed in as ada')
    } finally {
      await squatter.stop(true)
    }
  })

  test('is never a port another process answers on another loopback address', async () => {
    // A wildcard listener does not stop a bind to 127.0.0.1, and `localhost` may resolve to ::1.
    const wildcard = Bun.serve({
      port: preferredProxyPorts(fx.appOrigin)[0],
      hostname: '::',
      fetch: () => new Response('another process'),
    })
    try {
      const url = buildInjectedPreviewUrl(`${fx.appOrigin}/`)!
      for (const address of ['localhost', '127.0.0.1', '[::1]']) {
        const res = await fetch(url.replace('localhost', address))
        expect(await res.text()).toContain('Signed in as nobody')
      }
    } finally {
      await wildcard.stop(true)
    }
  })

  test('names an app on 127.0.0.1 by that address', async () => {
    const other = startPreviewAppFixture({ hostname: '127.0.0.1' })
    try {
      expect(new URL(buildInjectedPreviewUrl(`${other.appOrigin}/`)!).hostname).toBe('127.0.0.1')
    } finally {
      await other.stop()
    }
  })
})
