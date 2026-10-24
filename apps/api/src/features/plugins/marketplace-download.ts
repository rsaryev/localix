import { InvalidRequestError, UnprocessableError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'

/**
 * Plugin and marketplace downloads over HTTP(S), as Claude Code bounds them: redirects followed
 * by hand (at most five) so every hop's URL is checked before it is requested, a deadline over
 * the whole download (headers and body), and a byte ceiling enforced while the body streams.
 */

export const MAX_REDIRECTS = 5

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** Hosts a download may not reach: this machine, link-local space, cloud metadata. */
export function isForbiddenHost(hostname: string): boolean {
  // A trailing dot names the same host (`localhost.` is `localhost`).
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '::' ||
    host === '0.0.0.0' ||
    host.startsWith('0.') ||
    host.startsWith('127.') ||
    host.startsWith('169.254.') ||
    host.startsWith('fe80:') ||
    // IPv4-mapped IPv6 (the URL parser writes `::ffff:127.0.0.1` as `::ffff:7f00:1`).
    host.startsWith('::ffff:7f') ||
    host.startsWith('::ffff:a9fe:') ||
    host.startsWith('::ffff:127.') ||
    host.startsWith('::ffff:169.254.') ||
    host === 'metadata.google.internal' ||
    host === '100.100.100.200' ||
    host === 'fd00:ec2::254'
  )
}

/** Why `url` may not be requested (a hop of a redirect chain), or null when it may. */
export type HopCheck = (url: URL, from: URL | null) => string | null

export interface DownloadOptions {
  /** What is being downloaded, for error text ("Downloading https://…"). */
  what: string
  /** Deadline for the whole download, headers and body. */
  timeoutMs: number
  /** Checks the first URL and every redirect target before it is requested. */
  checkHop: HopCheck
  /** Error code of a refused hop, a failed request or a timeout. */
  code: string
  maxRedirects?: number
  /** Request headers for one hop (a registry token, a catalog's own headers), by its URL. */
  headers?: (url: URL) => Record<string, string> | undefined
}

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name
  return name === 'TimeoutError' || name === 'AbortError'
}

function failure(opts: DownloadOptions, err: unknown): Error {
  if (err instanceof InvalidRequestError || err instanceof UnprocessableError) return err
  return new InvalidRequestError(
    opts.code,
    isTimeout(err)
      ? `${opts.what} timed out after ${opts.timeoutMs >= 1000 ? `${opts.timeoutMs / 1000} s` : `${opts.timeoutMs} ms`}`
      : `${opts.what} failed: ${errorMessage(err)}`,
  )
}

function refuse(opts: DownloadOptions, url: URL, from: URL | null): void {
  const problem = opts.checkHop(url, from)
  if (problem) throw new InvalidRequestError(opts.code, `${opts.what} refused: ${problem}`)
}

/**
 * Request `url`, following at most `maxRedirects` redirects by hand. Every URL is checked with
 * `checkHop` before it is requested; a non-2xx final answer throws. The returned response's body
 * stays under the deadline, so read it with `readCapped`.
 */
export async function fetchChecked(
  url: string,
  opts: DownloadOptions,
): Promise<{ response: Response; signal: AbortSignal }> {
  const signal = AbortSignal.timeout(opts.timeoutMs)
  const max = opts.maxRedirects ?? MAX_REDIRECTS
  let current: URL
  try {
    current = new URL(url)
  } catch {
    throw new InvalidRequestError(opts.code, `${opts.what} failed: not a URL: ${url}`)
  }
  refuse(opts, current, null)
  try {
    for (let hops = 0; ; hops++) {
      const headers = opts.headers?.(current)
      const response = await fetch(current, {
        redirect: 'manual',
        signal,
        ...(headers ? { headers } : {}),
      })
      const location = response.headers.get('location')
      if (!REDIRECT_STATUSES.has(response.status) || !location) {
        if (!response.ok)
          throw new InvalidRequestError(
            opts.code,
            `${opts.what} failed: HTTP ${response.status} ${current.href}`,
          )
        return { response, signal }
      }
      await response.body?.cancel().catch(() => {})
      if (hops >= max)
        throw new InvalidRequestError(opts.code, `${opts.what} failed: more than ${max} redirects`)
      const next = new URL(location, current)
      refuse(opts, next, current)
      current = next
    }
  } catch (err) {
    throw failure(opts, err)
  }
}

/** Read a body, refusing one larger than `maxBytes` before it is all in memory. */
export async function readCapped(
  response: Response,
  maxBytes: number,
  opts: Pick<DownloadOptions, 'what' | 'timeoutMs' | 'code'> & { tooLargeCode: string },
): Promise<Buffer> {
  const tooLarge = () =>
    new UnprocessableError(opts.tooLargeCode, `${opts.what} exceeds ${maxBytes} bytes`)
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw tooLarge()
  }
  const reader = response.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw tooLarge()
      }
      chunks.push(value)
    }
  } catch (err) {
    throw failure({ ...opts, checkHop: () => null }, err)
  }
  return Buffer.concat(chunks)
}

/** Hop rule for an archive: every URL `https://` on a public host. */
export const httpsPublicHop: HopCheck = (url) =>
  url.protocol !== 'https:' || isForbiddenHost(url.hostname)
    ? `${url.href} is not https:// on a public host`
    : null

/**
 * Hop rule for a hosted catalog: the first URL http(s); a redirect within the origin is free, a
 * redirect to another origin must be `https://` on a public host (so https → http fails).
 */
export const catalogHop: HopCheck = (url, from) => {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return `${url.href} is not http(s)`
  if (!from || url.origin === from.origin) return null
  return httpsPublicHop(url, from)
}
