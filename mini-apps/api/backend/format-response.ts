/**
 * Rendering a response for the MODEL. Pure — no fetch, no host.
 *
 * The audience is the thing to keep in mind: the model needs the status, the few headers that
 * change what it should do next, and the body. A full header dump is dozens of tokens of CDN
 * trivia (`cf-ray`, `x-served-by`, `report-to`) on every single call, so headers are filtered to
 * an allow-list. The body is never summarised — that's the answer.
 */

import type { SendResult } from './send'
import { filterJson } from './response-filter'
import type { RequestSpec } from './request-spec'

/** Headers worth the tokens: they explain the status, the shape, or what to do next. */
const KEEP_HEADERS: ReadonlySet<string> = new Set([
  'content-type',
  'location',
  'retry-after',
  'www-authenticate',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-limit',
  'link',
])

export function interestingHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (KEEP_HEADERS.has(name.toLowerCase())) out[name.toLowerCase()] = value
  }
  return out
}

/** Pretty-print a JSON body so the model reads structure rather than one long line. */
export function prettyBody(body: string, contentType: string | undefined): string {
  if (!contentType?.toLowerCase().includes('json')) return body
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body // Content-Type lied, or the body was truncated mid-value. Show it as it came.
  }
}

export function formatResponse(spec: RequestSpec, res: SendResult, filter?: string): string {
  const lines: string[] = []
  // HTTP/2 carries no reason phrase, so `statusText` is often empty — joining blindly leaves
  // `200  (10ms)`, a double space that reads as a missing word.
  const status = [res.status, res.statusText].filter((p) => `${p}` !== '').join(' ')
  lines.push(`${spec.method} ${res.url} → ${status} (${res.elapsedMs}ms)`)

  // ABOVE the body, not after it: this says the text below cannot be trusted, which is no use to
  // someone who has already read and believed it.
  if (res.charsetProblem) lines.push('', res.charsetProblem)

  // `hops` is structured now ({url,status,elapsedMs}); the model reads the chain of destinations,
  // so join their urls rather than the whole objects.
  if (res.hops.length > 1) {
    lines.push(`Redirects: ${res.hops.map((h) => h.url).join(' → ')}`)
  }

  const headers = interestingHeaders(res.headers)
  for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${value}`)

  lines.push('')
  // A FILTER replaces the body, and says so. The full response still went to the history ring, so
  // the workbench shows what actually came back — the narrowing is the model's view, not a loss.
  if (filter !== undefined) {
    const outcome = filterJson(res.body, filter)
    if (!outcome.ok) {
      // The unfiltered body is NOT dumped as a fallback: a filter is how a caller asks to keep a
      // large payload OUT of the conversation, and answering the failure with the whole thing
      // does the opposite of what was asked. The error says what to fix.
      lines.push(`Filter \`${filter}\` did not apply: ${outcome.error}`)
      return lines.join('\n')
    }
    lines.push(
      outcome.matches === 0
        ? `Filter \`${filter}\`: no matches. (The path may be wrong, or the field may be absent — ` +
            'JSONPath cannot tell those apart. Re-send without a filter to see the shape.)'
        : `Filter \`${filter}\` — ${outcome.matches} match${outcome.matches === 1 ? '' : 'es'}:`,
    )
    if (outcome.matches > 0) lines.push(outcome.content)
    return lines.join('\n')
  }

  const body = prettyBody(res.body, res.headers['content-type'])
  lines.push(body === '' ? '(empty body)' : body)

  if (res.truncated) {
    lines.push('')
    lines.push(
      `[truncated at ${res.bytes} bytes — the response was larger. Narrow it with a query parameter, or raise "Max response body" in the mini app settings.]`,
    )
  }
  return lines.join('\n')
}
