import type { SendErrorCode } from './send-errors'

/** True when `raw` parses as an http(s) URL. Other schemes are not ours to send. */
export function isHttpUrl(raw: string): boolean {
  try {
    const { protocol } = new URL(raw)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * A HOST written without a scheme: `api.dev/x`, `localhost:3000/api`, `127.0.0.1:8080`.
 *
 * A scheme is only accepted here when the author wrote `://`. `URL` does not enforce that boundary:
 * `new URL('localhost:3000/api')` parses successfully, treats `localhost:` as the scheme, and puts
 * the port in the path. Nothing throws, so every downstream check would reason about a URL the user
 * never wrote.
 *
 * The host-shaped check keeps real schemes out: `file:/etc/passwd` has no `://` either, and it must
 * not be excused as a typo.
 */
const SCHEMELESS_HOST =
  /^(?:localhost|\[[0-9a-f:]+\]|[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(?:[/?#]|$)/i

/**
 * A url problem: what to tell the person, AND what kind of problem it is.
 *
 * The code travels WITH the message rather than being recovered from it downstream. `errors.ts`
 * used to re-derive exactly this by regex, and every message that failed to match its patterns
 * silently became a `502 network_error` — "the upstream is broken" — for a url we never sent.
 */
export interface UrlProblem {
  code: SendErrorCode
  message: string
}

/**
 * Why `raw` cannot be sent, in words a person can act on — or null when it is a fine http(s) url.
 *
 * This exists because the two commonest wrong urls both produced an answer that was useless or
 * actively misleading:
 *
 *   `localhost:3000/api`  → 'Refusing to send to "localhost://…" — this client speaks http(s)
 *                           only. A localhost: url can read local files, and no setting enables
 *                           it.'
 *   `api.github.com/user` → '"api.github.com/user" cannot be parsed as a URL.'
 *
 * The first accuses someone of attempting an LFI for typing the most ordinary url in local
 * development, and never mentions the actual problem. The second is Bun's raw TypeError leaking
 * out of `new URL` — not our sentence at all, and it says nothing about what to do.
 *
 * WE DO NOT DEFAULT THE SCHEME. Doing so here would silently rewrite the request inside the send
 * path, and choosing `http:` could expose `${secret:KEY}` credentials resolved from the vault at
 * send time. Refusing costs a round trip; guessing wrong costs the credential.
 */
export function urlProblem(raw: string): UrlProblem | null {
  const url = raw.trim()
  if (url === '') return { code: 'bad_request', message: 'The url is empty.' }
  if (isHttpUrl(url)) return null

  if (!url.includes('://') && SCHEMELESS_HOST.test(url)) {
    return {
      code: 'bad_request',
      message:
        `"${url}" has no scheme, so there is nothing to send it over. Write it in full — ` +
        `"https://${url}" (or "http://${url}" if the server really does not do TLS). ` +
        'The scheme is not guessed for you: this client resolves ${secret:KEY} credentials at send ' +
        'time, and picking http:// on your behalf would put them on the wire in plaintext.',
    }
  }

  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    return {
      code: 'bad_request',
      message: `"${url}" is not a url this client can parse. It needs to look like "https://host/path".`,
    }
  }
  // `blocked`, not `bad_request`: `file:///etc/passwd` is a perfectly well-formed url and we are
  // REFUSING it. The distinction is the one errors.ts already draws — a 403 says "we won't", a 400
  // says "you can't write that" — and the UI must not offer a retry for the first.
  return {
    code: 'blocked',
    message:
      `Refusing to send to a "${protocol}" url — this client speaks http(s) only. ` +
      'A file:, data: or similar url can read local resources, and no setting enables it.',
  }
}
