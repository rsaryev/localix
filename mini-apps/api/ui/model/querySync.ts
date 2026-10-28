import type { Pair } from '../../backend/request-spec'

/**
 * URL input and the Params grid are two views of one query string. The stored representation keeps
 * the base URL and pairs separate; the input composes them for editing. This prevents a query from
 * being sent twice when it exists both in `spec.url` and `spec.query`.
 */

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    // A half-typed percent escape is valid editor state. Keep it visible instead of throwing.
    return value.replace(/\+/g, ' ')
  }
}

function encodePart(value: string): string {
  // Keep environment templates readable in the URL bar while encoding their surrounding value.
  return encodeURIComponent(value)
    .replace(/%7B%7B/gi, '{{')
    .replace(/%7D%7D/gi, '}}')
}

function splitHash(value: string): { beforeHash: string; hash: string } {
  const at = value.indexOf('#')
  return at < 0
    ? { beforeHash: value, hash: '' }
    : { beforeHash: value.slice(0, at), hash: value.slice(at) }
}

/** Parse what the person typed. Enabled rows come from the URL; disabled rows stay available. */
export function queryDraftFromUrl(
  value: string,
  previous: readonly Pair[],
): { url: string; query: Pair[] } {
  const { beforeHash, hash } = splitHash(value)
  const queryAt = beforeHash.indexOf('?')
  const base = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt)
  const raw = queryAt < 0 ? '' : beforeHash.slice(queryAt + 1)
  const enabled: Pair[] = []

  if (raw !== '') {
    for (const entry of raw.split('&')) {
      const equalAt = entry.indexOf('=')
      const name = equalAt < 0 ? entry : entry.slice(0, equalAt)
      const valuePart = equalAt < 0 ? '' : entry.slice(equalAt + 1)
      enabled.push({ name: decodePart(name), value: decodePart(valuePart) })
    }
  }

  return {
    url: `${base}${hash}`,
    query: [...enabled, ...previous.filter((pair) => pair.disabled)],
  }
}

/** Compose the URL input from the canonical base and enabled Params rows. */
export function urlWithQuery(url: string, query: readonly Pair[]): string {
  const { beforeHash, hash } = splitHash(url)
  // The grid is the source of truth for the query; anything after `?` in the URL is replaced.
  const base = beforeHash.split('?', 1)[0] ?? beforeHash
  const active = query.filter((pair) => !pair.disabled)
  if (active.length === 0) return `${base}${hash}`
  const raw = active.map(({ name, value }) => `${encodePart(name)}=${encodePart(value)}`).join('&')
  return `${base}?${raw}${hash}`
}

/** Normalize a URL that embeds its query (an import, a hand-edited file) into the canonical two-field model. */
export function canonicalUrlQuery(
  url: string,
  query: readonly Pair[],
): { url: string; query: Pair[] } {
  const { beforeHash } = splitHash(url)
  return beforeHash.includes('?') ? queryDraftFromUrl(url, query) : { url, query: [...query] }
}
