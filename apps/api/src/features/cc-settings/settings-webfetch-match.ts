import { isRecord } from '../../lib/record'
import { ccDomainRuleMatches } from './cc-path-rule'

/**
 * A `WebFetch(domain:…)` rule against the pages a call reads (permissions.md, "WebFetch"): the
 * hostname of each URL, without case or a trailing dot. `*.example.com` covers every subdomain at
 * any depth but not `example.com`; a bare `*` covers every host; any other `*` stands for the text
 * between two dots, so `example.*` matches `example.org` and never `example.evil.com`. Localix's
 * `research` tool reads the pages of its `urls`; a `url` field counts too.
 */

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
  const urls = fetchedUrls(input)
  if (urls.length === 0) return false
  const hit = (url: string) => ccDomainRuleMatches(specifier, url)
  return effect === 'allow' ? urls.every(hit) : urls.some(hit)
}
