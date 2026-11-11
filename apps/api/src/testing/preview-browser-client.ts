/**
 * TEST SUPPORT — the parts of a browser a proxy test needs, without a browser.
 *
 * Cookies are kept per hostname and sent to every port of it, as browsers do (RFC 6265 cookies are
 * not port-scoped). Redirects are followed by hand the way a document navigation follows them: a
 * 301/302/303 after a POST becomes a GET, and a relative `Location` resolves against the response
 * it came on. A form POST or a `fetch` sends `Origin` as the page it came from, which is the only
 * header a proxy's origin handling turns on. SameSite is not modelled: every request here is a
 * same-site, top-level one.
 */

export interface Visit {
  url: string
  status: number
  text: string
  /** Every address the navigation passed through, the first one included. */
  hops: string[]
}

interface Send {
  method?: string
  form?: Record<string, string>
  json?: unknown
  /** The document the request is made from: its origin becomes `Origin`, its URL `Referer`. */
  from?: string
}

export function createBrowserClient() {
  const jar = new Map<string, Map<string, string>>()

  const store = (url: URL, response: Response) => {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';')
      const at = pair!.indexOf('=')
      const name = pair!.slice(0, at).trim()
      const cookies = jar.get(url.hostname) ?? new Map<string, string>()
      jar.set(url.hostname, cookies)
      if (attributes.some((a) => a.trim().toLowerCase() === 'max-age=0')) cookies.delete(name)
      else cookies.set(name, pair!.slice(at + 1).trim())
    }
  }

  const send = async (raw: string, init: Send = {}): Promise<Response> => {
    const url = new URL(raw)
    const headers = new Headers()
    const cookies = jar.get(url.hostname)
    if (cookies?.size) {
      headers.set('cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '))
    }
    const method = init.method ?? (init.form || init.json !== undefined ? 'POST' : 'GET')
    if (init.from) {
      if (method !== 'GET' && method !== 'HEAD') headers.set('origin', new URL(init.from).origin)
      headers.set('referer', init.from)
    }
    let body: BodyInit | undefined
    if (init.form) body = new URLSearchParams(init.form)
    if (init.json !== undefined) {
      headers.set('content-type', 'application/json')
      body = JSON.stringify(init.json)
    }
    const response = await fetch(url, { method, headers, body, redirect: 'manual' })
    store(url, response)
    return response
  }

  return {
    /** The cookie names this browser holds for a hostname. */
    cookieNames: (hostname: string) => [...(jar.get(hostname)?.keys() ?? [])],

    /** A subresource or `fetch` request: no redirect is followed. */
    fetch: send,

    /** A document navigation, redirects followed to the page that finally loads. */
    async navigate(raw: string, init: Send = {}): Promise<Visit> {
      const hops = [raw]
      let response = await send(raw, init)
      let url = raw
      for (let i = 0; i < 10 && response.status >= 300 && response.status < 400; i++) {
        url = new URL(response.headers.get('location')!, url).href
        // A redirected navigation is a GET with no initiating page of its own.
        response = await send(url)
        hops.push(url)
      }
      return { url, status: response.status, text: await response.text(), hops }
    },
  }
}
