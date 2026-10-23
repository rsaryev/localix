/**
 * Cookies for the length of ONE redirect chain — the thing a login flow needs and nothing more.
 *
 * WHY THIS EXISTS. `POST /login → 302 + Set-Cookie: session=… → GET /dashboard` is how session
 * auth works everywhere. We follow that redirect ourselves (`redirect: 'manual'`, so every hop is
 * guarded), which means we — not the runtime — are the thing that has to carry the cookie. We
 * weren't. Measured:
 *
 *   POST https://api.dev/login       Cookie: (none)   → 302, Set-Cookie: session=abc123
 *   GET  https://api.dev/dashboard   Cookie: (none)   → 200 "<html>Please log in</html>"
 *
 * The caller gets `200 OK`. Every other part of this mini app teaches that 2xx means it worked, so
 * an agent reports a successful login while standing on the login page. A success status covering
 * a failed operation is the most expensive kind of wrong this integration produces, because
 * nothing looks wrong.
 *
 * WHAT THIS IS NOT. Not a cookie jar. There is no persistence between requests, no `Domain`
 * matching, no `Path` scoping, no expiry dates, no `Secure`/`HttpOnly` enforcement. Those matter
 * for a browser, which holds cookies for months across every site you visit. This holds them for
 * the handful of hops inside one `sendRequest` call and then drops them on the floor.
 *
 * The one scoping rule that IS enforced is the one that could leak a credential: cookies never
 * cross an ORIGIN boundary. `stripAuthAcrossOrigin` already drops a user's `Cookie` header on a
 * cross-origin hop, and a jar that quietly re-added the session on the next hop would have undone
 * that guard from the inside. Same-origin over-sending (ignoring `Path`) stays within the server
 * that set the cookie; sending it elsewhere does not, and only one of those is a leak.
 */

export interface Cookie {
  name: string
  value: string
}

/**
 * One `Set-Cookie` value → its name and value, or null when it carries neither.
 *
 * Attributes after the first `;` are read only for `Max-Age=0`; see the header for why the rest
 * are ignored rather than half-implemented.
 */
export function parseSetCookie(raw: string): Cookie | { name: string; deleted: true } | null {
  const [pair, ...attrs] = raw.split(';')
  const eq = pair.indexOf('=')
  if (eq <= 0) return null // `=v` has no name and `flag` is not a cookie
  const name = pair.slice(0, eq).trim()
  if (name === '') return null
  const value = pair.slice(eq + 1).trim()

  // `Max-Age=0` is how a server deletes a cookie — a logout inside a redirect chain. Honoured
  // because the alternative is carrying a cookie the server just told us to throw away.
  const deleted = attrs.some((a) => {
    const [k, v] = a.split('=')
    return k?.trim().toLowerCase() === 'max-age' && Number(v?.trim()) <= 0
  })
  return deleted ? { name, deleted: true } : { name, value }
}

/**
 * Fold a response's `Set-Cookie` headers into the jar. A later value for a name replaces an
 * earlier one, which is what a browser does and what a session-rotation flow relies on.
 *
 * `setCookies` MUST come from `Headers.getSetCookie()`. `headers.get('set-cookie')` folds every
 * cookie into one comma-joined string, and a comma is legal inside `Expires=Wed, 21 Oct 2015…` —
 * so splitting that back apart is guesswork. The array form is the only one that is not.
 */
export function collectCookies(jar: readonly Cookie[], setCookies: readonly string[]): Cookie[] {
  const byName = new Map(jar.map((c) => [c.name, c.value]))
  for (const raw of setCookies) {
    const parsed = parseSetCookie(raw)
    if (!parsed) continue
    if ('deleted' in parsed) byName.delete(parsed.name)
    else byName.set(parsed.name, parsed.value)
  }
  return [...byName].map(([name, value]) => ({ name, value }))
}

/** The `Cookie` header value for a jar, or '' when it is empty. */
export function cookieHeaderValue(jar: readonly Cookie[]): string {
  return jar.map((c) => `${c.name}=${c.value}`).join('; ')
}

/**
 * Merge the jar into whatever `Cookie` header the request already carries.
 *
 * A user's own `Cookie` header (or an `apikey` with `addTo: 'cookie'`) is deliberate and WINS on a
 * name clash: they wrote it, the server merely offered. Their value going out is a request they
 * can reason about; being silently overwritten by a redirect is not.
 */
export function mergeCookieHeader(existing: string | undefined, jar: readonly Cookie[]): string {
  if (jar.length === 0) return existing ?? ''
  const theirs = new Set(
    (existing ?? '')
      .split(';')
      .map((c) => c.split('=')[0]?.trim())
      .filter((n): n is string => !!n),
  )
  const added = cookieHeaderValue(jar.filter((c) => !theirs.has(c.name)))
  if (!existing?.trim()) return added
  return added ? `${existing}; ${added}` : existing
}
