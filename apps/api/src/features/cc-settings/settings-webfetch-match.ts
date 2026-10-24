import { isRecord } from '../../lib/record'

/**
 * A `WebFetch(domain:…)` rule against the pages a call reads (permissions.md, "WebFetch"): the
 * hostname of each URL, without case or a trailing dot. `*.example.com` covers every subdomain at
 * any depth but not `example.com`; a bare `*` covers every host; any other `*` stands for the text
 * between two dots, so `example.*` matches `example.org` and never `example.evil.com`. Localix's
 * `research` tool reads the pages of its `urls`; a `url` field counts too.
 */

const host = (raw: string): string | null => {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return null
  }
}

export function domainMatches(pattern: string, hostname: string): boolean {
  const rule = pattern.trim().toLowerCase().replace(/\.$/, '')
  if (rule === '*') return true
  if (rule.startsWith('*.')) return hostname.endsWith(rule.slice(1))
  const source = rule
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^.]*')
  return new RegExp(`^${source}$`).test(hostname)
}

/** The URLs a call reads. */
export function fetchedUrls(input: unknown): string[] {
  if (!isRecord(input)) return []
  const urls = Array.isArray(input.urls) ? input.urls : []
  return [...urls, input.url].filter((url): url is string => typeof url === 'string')
}

export function webFetchRuleMatches(
  specifier: string,
  input: unknown,
  effect: 'allow' | 'ask' | 'deny',
): boolean {
  const match = /^domain:(.+)$/.exec(specifier.trim())
  if (!match) return false
  const hosts = fetchedUrls(input).map(host)
  if (hosts.length === 0) return false
  const hit = (h: string | null) => h !== null && domainMatches(match[1]!, h)
  return effect === 'allow' ? hosts.every(hit) : hosts.some(hit)
}
