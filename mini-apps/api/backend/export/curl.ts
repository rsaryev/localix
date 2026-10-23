/**
 * RequestSpec → a cURL command. The reverse of `import/curl.ts`: a saved request becomes a
 * shareable one-liner an agent can paste into API docs or a person into a terminal.
 *
 * THE ONE INVARIANT THIS FILE EXISTS TO HOLD: a real credential NEVER lands in exported text.
 * A curl string is the most copy-pasteable, most likely-to-be-committed artifact this mini app
 * produces — into a chat, an issue, a shell history — so it is exactly where a leaked token does
 * the most damage. The serializer therefore works from `redactSpec(spec)`, which masks a literal
 * to `••••••` and leaves a `${secret:KEY}` reference legible. The reference is DELIBERATELY kept
 * verbatim: it is a pointer, not a secret, and it is what makes the exported command reproducible
 * once the recipient's vault holds the key. We never resolve the vault here — this module is pure,
 * and a serializer that could read a secret is a serializer that could write one into a clipboard.
 *
 * Templates and path placeholders are kept AS-WRITTEN (`{{base_url}}`, an unfilled `:id`): the
 * export represents the SAVED request, not a single rendering of it. A FILLED path parameter is
 * substituted, because that value is part of the request the user built.
 */

// Every argument is POSIX SINGLE-quoted, which takes everything literally: a `${secret:KEY}` is
// neither expanded by the shell nor mangled in the text (a backslash-escaping quoter would render it
// `\$\{secret:KEY\}`, breaking the copy and the "keep the reference legible" contract).
import { shellQuote as shQuote } from '@localixai/mini-app-sdk/backend'
import { redactSpec } from '../store'
import {
  activePairs,
  applyPathParams,
  bodyIsForm,
  isMultipart,
  methodAllowsBody,
  type Pair,
  type RequestAuth,
  type RequestBody,
  type RequestSpec,
} from '../request-spec'

/**
 * The url: path placeholders filled from `pathParameters`, enabled query pairs appended.
 *
 * Built by STRING concatenation, not `new URL`, because a saved url may be a `{{template}}` that is
 * not a url until an environment renders it — and the export keeps the template. Query pairs are
 * appended with a literal `?`/`&`, each value percent-encoded the way `buildUrl` encodes it on send,
 * so the exported command targets exactly what the workbench would.
 */
function curlUrl(spec: RequestSpec): string {
  let url = applyPathParams(spec.url, spec.pathParameters)
  const pairs = activePairs(spec.query)
  if (spec.auth.type === 'apikey' && spec.auth.addTo === 'query') {
    // An apikey placed in the query is part of the url the SSRF guard checks and fetch calls, so it
    // rides in the url here too — masked, because `spec` was redacted before this ran.
    pairs.push({ name: spec.auth.key, value: spec.auth.value })
  }
  if (pairs.length > 0) {
    const qs = pairs
      .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`)
      .join('&')
    url += (url.includes('?') ? '&' : '?') + qs
  }
  return url
}

/**
 * Auth as curl flag lines, from the already-REDACTED auth block. Mirrors `applyAuth`'s placement
 * (bearer/basic → `Authorization`, apikey → header / cookie) so a round-trip through
 * `import/curl.ts` lands back on the same auth. `addTo: 'query'` produces no flag — it is folded
 * into the url by `curlUrl`, the one place a query credential belongs. Values are masks or
 * `${secret:}` references — never a literal — because the caller redacted the spec first.
 */
function authLines(auth: RequestAuth): string[] {
  switch (auth.type) {
    case 'none':
      return []
    case 'basic':
      // `-u user:pass` is curl's own basic auth, and `import/curl.ts` reads it back as basic.
      return [`-u ${shQuote(`${auth.username}:${auth.password}`)}`]
    case 'bearer': {
      const prefix = auth.prefix?.trim() || 'Bearer'
      return [`-H ${shQuote(`Authorization: ${prefix} ${auth.token}`)}`]
    }
    case 'apikey': {
      const addTo = auth.addTo ?? 'header'
      if (addTo === 'query') return [] // folded into the url — see `curlUrl`
      if (addTo === 'cookie') return [`-b ${shQuote(`${auth.key}=${auth.value}`)}`]
      return [`-H ${shQuote(`${auth.key}: ${auth.value}`)}`]
    }
  }
}

/** Header flag lines for the request's own headers (already redacted — credential headers masked). */
function headerLines(headers: readonly Pair[]): string[] {
  return activePairs(headers).map((h) => `-H ${shQuote(`${h.name}: ${h.value}`)}`)
}

/**
 * Body flag lines. A form body uses the flag that reproduces its ENCODING — `--data-urlencode` for
 * urlencoded (curl encodes the value, matching `URLSearchParams` on send), `-F` for multipart (curl
 * writes the boundary, which a hand-set `Content-Type` cannot). A text body uses `--data-raw`, so a
 * leading `@` in the payload is sent literally rather than read as a filename.
 */
function bodyLines(body: RequestBody): string[] {
  if (bodyIsForm(body)) {
    const flag = isMultipart(body) ? '-F' : '--data-urlencode'
    return activePairs(body.form).map((p) => `${flag} ${shQuote(`${p.name}=${p.value}`)}`)
  }
  if (typeof body.text !== 'string' || body.text === '') return []
  return [`--data-raw ${shQuote(body.text)}`]
}

/**
 * Serialize a saved request to a cURL command.
 *
 * `spec` may carry literal credentials (it comes from the store); this redacts BEFORE touching a
 * single field, so nothing downstream can read a secret even by accident. The output is a
 * multi-line command with `\`-continued flags — the shape "Copy as cURL" produces, because that is
 * the shape people recognise as safe to run.
 */
export function toCurl(rawSpec: RequestSpec): string {
  const spec = redactSpec(rawSpec)

  // A method beyond GET is stated on the head line: a bodied PUT/PATCH would otherwise be ambiguous,
  // and relying on curl's "a body implies POST" defaulting for a shared command is a trap.
  const head = `curl${spec.method !== 'GET' ? ` -X ${spec.method}` : ''} ${shQuote(curlUrl(spec))}`

  const lines: string[] = [...headerLines(spec.headers), ...authLines(spec.auth)]

  if (methodAllowsBody(spec.method) && spec.body) {
    // A Content-Type for a TEXT body is emitted explicitly (curl defaults `--data-raw` to
    // urlencoded); a form body lets curl set it — with the multipart boundary it alone can write.
    if (!bodyIsForm(spec.body) && spec.body.mimeType) {
      const hasCt = activePairs(spec.headers).some((h) => h.name.toLowerCase() === 'content-type')
      if (!hasCt) lines.push(`-H ${shQuote(`Content-Type: ${spec.body.mimeType}`)}`)
    }
    lines.push(...bodyLines(spec.body))
  }

  // The saved request follows redirects unless it opted out (see send.ts), so a faithful command
  // adds `-L` — curl does NOT follow by default, and a command that behaved differently from the
  // request it exports would be a quiet lie.
  if (spec.followRedirects !== false) lines.push('-L')

  return [head, ...lines].join(' \\\n  ')
}
