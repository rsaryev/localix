const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * How an address reads while nobody is editing it: host and path with percent-escapes decoded,
 * without the scheme or a leading `www.`.
 *
 * A search arrives as `search?q=caf%C3%A9%20cr%C3%A8me` — the words the person typed, in a form
 * nobody can read. The editable value stays the exact URL; this is only what the idle field shows.
 * `http://` stays visible on a remote host, where it is the one part worth noticing.
 */
export function readableAddress(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url
  const scheme =
    parsed.protocol === 'http:' && !LOOPBACK_HOSTS.has(parsed.hostname) ? 'http://' : ''
  const path = parsed.pathname === '/' ? '' : parsed.pathname
  const text = `${scheme}${parsed.host.replace(/^www\./, '')}${path}${parsed.search}${parsed.hash}`
  try {
    // decodeURI keeps escaped delimiters (`%2F`, `%26`) escaped, so the structure survives.
    return decodeURI(text)
  } catch {
    return text
  }
}

/** Resolve a web address, or use Google for plain search text. Never forward unsafe schemes. */
export function resolvePreviewAddress(value: string, current: string): string | null {
  const input = value.trim()
  if (!input) return null
  const relative = /^[/?#]/.test(input)
  if (relative && !current) return null
  const explicitWeb = /^https?:\/\//i.test(input)
  const hostWithPort = /^[^\s/?#:@]+:\d+(?:[/?#]|$)/.test(input)
  // A typed explicit non-web scheme must not be reinterpreted as search or a hostname.
  if (/^[a-z][a-z\d+.-]*:/i.test(input) && !explicitWeb && !hostWithPort) return null
  const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(input)
  const domain = /^[^\s/@:]+\.[^\s/@:]+(?::\d+)?(?:[/?#]|$)/.test(input)
  if (!relative && !explicitWeb && !localHost && !hostWithPort && !domain) {
    return `https://www.google.com/search?q=${encodeURIComponent(input)}`
  }
  try {
    const scheme = localHost || (hostWithPort && !domain) ? 'http' : 'https'
    const address = new URL(
      relative ? input : explicitWeb ? input : `${scheme}://${input}`,
      current || undefined,
    )
    if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password)
      return null
    return address.href
  } catch {
    return null
  }
}
