/**
 * TEST SUPPORT — a small web app and an OAuth identity provider, for previewing through the proxy.
 *
 * The app behaves like a strict real one: a state-changing request is refused unless its `Origin`
 * (or, without one, its `Referer`) is the app's own configured origin and `Host` names it; the
 * session is an `HttpOnly; SameSite=Lax` cookie; sign-in is OAuth 2.0 authorization code + PKCE
 * against the provider on another port, with the state and verifier kept in a cookie and the
 * `redirect_uri` registered as the app's real origin. It also has the shapes that broke in the
 * preview: a cookie set on a redirect, a redirect to another site, a page that refuses framing, and
 * a single-page app whose script is a relative path behind a trailing-slash redirect.
 */

import { createHash, randomBytes } from 'node:crypto'

export interface RecordedRequest {
  server: 'app' | 'idp' | 'external'
  method: string
  path: string
  host: string | null
  origin: string | null
  referer: string | null
  cookie: string | null
}

export interface PreviewAppFixture {
  appOrigin: string
  idpOrigin: string
  externalOrigin: string
  requests: RecordedRequest[]
  stop(): Promise<void>
}

export interface PreviewAppFixtureOptions {
  /** The name the app and provider call themselves by. */
  hostname?: 'localhost' | '127.0.0.1'
  /** Fixed ports for a live run; 0 (any free port) by default. */
  appPort?: number
  idpPort?: number
  externalPort?: number
}

const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(
    `<!doctype html><html><head><title>Fixture</title></head><body>${body}</body></html>`,
    {
      headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    },
  )

const redirect = (location: string, cookies: string[] = [], status = 302) => {
  const headers = new Headers({ location })
  for (const cookie of cookies) headers.append('set-cookie', cookie)
  return new Response(null, { status, headers })
}

function cookieOf(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return undefined
}

/** A form field's text; a missing field or a file is empty. */
function field(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')
const token = () => randomBytes(16).toString('base64url')
const escape = (value: string) => value.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

/** The CSRF rule of a strict app: the request must come from its own origin, addressed to it. */
function refusesOrigin(req: Request, ownOrigin: string): string | null {
  const host = req.headers.get('host')
  if (host !== new URL(ownOrigin).host) return `host ${host} is not ${new URL(ownOrigin).host}`
  const origin = req.headers.get('origin')
  if (origin !== null) return origin === ownOrigin ? null : `origin ${origin} is not ${ownOrigin}`
  const referer = req.headers.get('referer')
  if (referer !== null && URL.parse(referer)?.origin === ownOrigin) return null
  return `no origin, referer ${referer} is not ${ownOrigin}`
}

export function startPreviewAppFixture(options: PreviewAppFixtureOptions = {}): PreviewAppFixture {
  const name = options.hostname ?? 'localhost'
  const requests: RecordedRequest[] = []
  const record = (server: RecordedRequest['server'], req: Request) => {
    const url = new URL(req.url)
    requests.push({
      server,
      method: req.method,
      path: url.pathname + url.search,
      host: req.headers.get('host'),
      origin: req.headers.get('origin'),
      referer: req.headers.get('referer'),
      cookie: req.headers.get('cookie'),
    })
  }
  const sessions = new Map<string, { user: string; theme: string }>()
  const codes = new Map<string, { challenge: string; redirectUri: string; user: string }>()
  let appOrigin = ''
  let idpOrigin = ''

  const external = Bun.serve({
    port: options.externalPort ?? 0,
    hostname: '127.0.0.1',
    fetch(req) {
      record('external', req)
      return html('<h1>External site</h1>')
    },
  })
  const externalOrigin = `http://127.0.0.1:${external.port}`

  const app = Bun.serve({
    port: options.appPort ?? 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      record('app', req)
      const url = new URL(req.url)
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const refused = refusesOrigin(req, appOrigin)
        if (refused) return new Response(`CSRF check failed: ${refused}`, { status: 403 })
      }
      const sid = cookieOf(req, 'sid')
      const session = sid ? sessions.get(sid) : undefined
      switch (`${req.method} ${url.pathname}`) {
        case 'GET /':
          return html(
            `<h1>Signed in as ${escape(session?.user ?? 'nobody')}</h1>` +
              `<p id="theme">Theme: ${escape(session?.theme ?? 'unset')}</p>` +
              `<a href="/login">Sign in</a> <a href="/settings">Settings</a>`,
          )
        case 'GET /settings':
          return html(
            `<p id="saved">${cookieOf(req, 'flash') === 'saved' ? 'Saved' : ''}</p>` +
              `<p id="theme">Theme: ${escape(session?.theme ?? 'unset')}</p>` +
              `<form method="post" action="/settings"><input name="theme" aria-label="Theme">` +
              `<button>Save</button></form>`,
          )
        case 'POST /settings': {
          if (!session) return new Response('Sign in first', { status: 401 })
          session.theme = field(await req.formData(), 'theme')
          return redirect('/settings', ['flash=saved; Path=/; HttpOnly; SameSite=Lax'], 303)
        }
        case 'GET /api/settings':
          return session
            ? Response.json({ theme: session.theme })
            : new Response(null, { status: 401 })
        case 'POST /api/settings': {
          if (!session) return new Response(null, { status: 401 })
          const { theme } = (await req.json()) as { theme?: unknown }
          session.theme = typeof theme === 'string' ? theme : ''
          return Response.json({ theme: session.theme })
        }
        case 'GET /login': {
          const state = token()
          const verifier = token() + token()
          const query = new URLSearchParams({
            response_type: 'code',
            client_id: 'fixture-app',
            redirect_uri: `${appOrigin}/callback`,
            state,
            code_challenge: s256(verifier),
            code_challenge_method: 'S256',
          })
          return redirect(`${idpOrigin}/authorize?${query}`, [
            `oauth=${state}.${verifier}; Path=/; HttpOnly; SameSite=Lax`,
          ])
        }
        case 'GET /callback': {
          const [state, verifier] = (cookieOf(req, 'oauth') ?? '').split('.')
          if (!state || state !== url.searchParams.get('state')) {
            return new Response('OAuth state mismatch', { status: 400 })
          }
          const exchanged = await fetch(`${idpOrigin}/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code: url.searchParams.get('code') ?? '',
              code_verifier: verifier ?? '',
              redirect_uri: `${appOrigin}/callback`,
            }),
          })
          if (!exchanged.ok) return new Response(await exchanged.text(), { status: 400 })
          const { sub } = (await exchanged.json()) as { sub: string }
          const id = token()
          sessions.set(id, { user: sub, theme: 'unset' })
          // An absolute redirect to the configured origin, as most frameworks build it.
          return redirect(`${appOrigin}/`, [
            `sid=${id}; Path=/; HttpOnly; SameSite=Lax`,
            'oauth=; Path=/; Max-Age=0',
          ])
        }
        case 'GET /external':
          return redirect(`${externalOrigin}/landing`)
        case 'GET /noframing':
          return html('<h1>No framing</h1>', {
            'x-frame-options': 'DENY',
            'content-security-policy': "frame-ancestors 'none'",
          })
        case 'GET /app':
          return redirect('/app/', [], 301)
        case 'GET /app/':
          return html('<div id="root"></div><script src="./main.js"></script>')
        case 'GET /app/main.js':
          return new Response("document.getElementById('root').textContent = 'App rendered'", {
            headers: { 'content-type': 'text/javascript' },
          })
        default:
          return new Response('Not found', { status: 404 })
      }
    },
  })
  appOrigin = `http://${name}:${app.port}`

  const idp = Bun.serve({
    port: options.idpPort ?? 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      record('idp', req)
      const url = new URL(req.url)
      if (url.pathname === '/authorize' && req.method === 'GET') {
        if (url.searchParams.get('redirect_uri') !== `${appOrigin}/callback`) {
          return new Response('redirect_uri is not registered', { status: 400 })
        }
        const hidden = [...url.searchParams]
          .map(([k, v]) => `<input type="hidden" name="${escape(k)}" value="${escape(v)}">`)
          .join('')
        // A relative form action, as every provider's login page has.
        return html(
          `<h1>Identity provider</h1><form method="post" action="/authorize">${hidden}` +
            `<input name="user" aria-label="User" value="ada"><button>Allow</button></form>`,
        )
      }
      if (url.pathname === '/authorize' && req.method === 'POST') {
        const refused = refusesOrigin(req, idpOrigin)
        if (refused) return new Response(`IdP CSRF check failed: ${refused}`, { status: 403 })
        const form = await req.formData()
        const redirectUri = field(form, 'redirect_uri')
        const code = token()
        codes.set(code, {
          challenge: field(form, 'code_challenge'),
          redirectUri,
          user: field(form, 'user'),
        })
        const query = new URLSearchParams({ code, state: field(form, 'state') })
        return redirect(`${redirectUri}?${query}`)
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        const form = await req.formData()
        const grant = codes.get(field(form, 'code'))
        codes.delete(field(form, 'code'))
        if (!grant || grant.redirectUri !== field(form, 'redirect_uri')) {
          return new Response('invalid_grant', { status: 400 })
        }
        if (s256(field(form, 'code_verifier')) !== grant.challenge) {
          return new Response('PKCE verifier does not match', { status: 400 })
        }
        return Response.json({ sub: grant.user })
      }
      return new Response('Not found', { status: 404 })
    },
  })
  idpOrigin = `http://${name}:${idp.port}`

  return {
    appOrigin,
    idpOrigin,
    externalOrigin,
    requests,
    async stop() {
      await Promise.all([app.stop(true), idp.stop(true), external.stop(true)])
    },
  }
}
