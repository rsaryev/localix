import type { AgentToolResult } from '@localixai/agent/agents'
import { errorMessage } from '../../../../lib/errors'
import {
  checkUrlSafety,
  readBodyCapped,
  type HostResolver,
  type HttpFetch,
} from '@localixai/mini-app-sdk/backend'
import { extractTitle } from './html-text'
import { extractReadable } from './readable-extract'

/**
 * Internal readable-page loader for the composite `Research` tool.
 *
 * This is intentionally not model-facing. Discovery and direct URL reads share
 * the one public `research` contract, while this module owns the bounded,
 * redirect-aware content load used after candidates are ranked.
 *
 * SSRF guard: every hop (including redirects) is resolved and rejected if it
 * points at a loopback / private / link-local address, unless the user opts in via
 * the `research.allowPrivate` setting (injected as DATA — this module reads no
 * settings itself). Read-only + stateless → parallel-safe.
 */

export interface ReadablePageInput {
  url: string
}

export interface ReadablePageDetails {
  url: string
  finalUrl: string
  status: number
  contentType: string
  title?: string
  bytes: number
  truncated: boolean
  downloadTruncated: boolean
}

export interface ReadablePageConfig {
  userAgent: string
  maxChars: number
  maxBytes: number
  timeoutMs: number
  maxRedirects: number
  allowPrivate: boolean
}

/** Deps injected for testing (real fetch/DNS in production). */
export interface ReadablePageDeps {
  fetchImpl?: HttpFetch
  resolveHost?: HostResolver
  config?: Partial<ReadablePageConfig>
}

function resolveConfig(overrides?: Partial<ReadablePageConfig>): ReadablePageConfig {
  return {
    userAgent: 'Mozilla/5.0 (compatible; localix-research/1.0)',
    maxChars: 50_000,
    // Hard cap on bytes DOWNLOADED (distinct from maxChars, which trims the text).
    maxBytes: 10_000_000,
    timeoutMs: 15_000,
    maxRedirects: 5,
    allowPrivate: false,
    ...overrides,
  }
}

const err = (content: string): AgentToolResult<ReadablePageDetails> => ({
  content,
  isError: true,
})

/**
 * Pure(-ish) core: fetch a readable page. All I/O flows through the injected
 * `fetchImpl` / `resolveHost` so tests never touch the network.
 */
export async function fetchReadablePage(
  input: ReadablePageInput,
  deps: ReadablePageDeps & { signal?: AbortSignal } = {},
): Promise<AgentToolResult<ReadablePageDetails>> {
  const cfg = resolveConfig(deps.config)
  const doFetch = deps.fetchImpl ?? fetch

  let parsed: URL
  try {
    parsed = new URL(input.url)
  } catch {
    return err(`Invalid URL: ${input.url}. Pass an absolute http(s) URL.`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return err(`Unsupported protocol: ${parsed.protocol}. Only http(s) URLs are allowed.`)
  }

  // Our own timeout, combined with the agent's abort signal.
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), cfg.timeoutMs)
  const signal = deps.signal
    ? AbortSignal.any([deps.signal, timeoutController.signal])
    : timeoutController.signal

  try {
    // Follow redirects manually so EVERY hop passes the SSRF check — a public URL
    // must not be able to bounce the agent into 169.254.x / 127.x targets.
    let current = parsed
    let res: Response
    for (let hop = 0; ; hop++) {
      if (!cfg.allowPrivate) {
        const unsafe = await checkUrlSafety(current, deps.resolveHost)
        if (unsafe) {
          return err(
            `Blocked: ${unsafe}. To let the agent fetch internal URLs (your own dev server, a LAN host), enable "Allow private/local URLs" under Settings → System → Access and context.`,
          )
        }
      }
      res = await doFetch(current, {
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': cfg.userAgent, Accept: '*/*' },
      })
      const location = res.headers.get('location')
      if (res.status < 300 || res.status >= 400 || !location) break
      if (hop >= cfg.maxRedirects) {
        return err(`Too many redirects fetching ${input.url} (>${cfg.maxRedirects}).`)
      }
      current = new URL(location, current)
      if (current.protocol !== 'http:' && current.protocol !== 'https:') {
        return err(`Redirected to unsupported protocol: ${current.protocol}.`)
      }
    }

    const contentType = res.headers.get('content-type') ?? ''
    // PDF bytes used to be decoded as text and sent to the model as source evidence.
    // Reject the MIME type before downloading the body, including for direct URLs.
    const pdfError = `PDF at ${current.href} cannot be read as a web page.`
    if (/^application\/pdf(?:\s*;|\s*$)/i.test(contentType.trim())) return err(pdfError)
    const {
      text: rawBody,
      bytes,
      truncated: downloadTruncated,
    } = await readBodyCapped(res, cfg.maxBytes)
    // Some servers omit or mislabel Content-Type; the file signature catches those.
    if (rawBody.startsWith('%PDF-')) return err(pdfError)

    const isHtml = contentType.includes('html') || /^\s*<(!doctype|html)/i.test(rawBody)
    // HTML goes through the Readability→Markdown pipeline so the article body (not chrome)
    // survives the maxChars cap; non-HTML (JSON/plain) is passed through untouched.
    let title: string | undefined
    let rendered = rawBody
    if (isHtml) {
      const extracted = await extractReadable(rawBody, current.href, 'markdown')
      rendered = extracted.text
      title = extracted.title ?? extractTitle(rawBody)
    }

    const truncated = rendered.length > cfg.maxChars
    let body = truncated
      ? `${rendered.slice(0, cfg.maxChars)}\n\n…[truncated ${rendered.length - cfg.maxChars} more chars — refetch a narrower URL if you need the rest]`
      : rendered
    if (downloadTruncated)
      body += `\n\n…[download capped at ${cfg.maxBytes} bytes — the response was larger]`

    const header = [
      title ? `Title: ${title}` : null,
      current.href !== input.url ? `Final URL: ${current.href}` : null,
      res.ok ? null : `HTTP ${res.status}`,
    ]
      .filter(Boolean)
      .join('\n')

    const content = `${header ? `${header}\n\n` : ''}${body || '(empty response)'}`
    const details: ReadablePageDetails = {
      url: input.url,
      finalUrl: current.href,
      status: res.status,
      contentType,
      ...(title ? { title } : {}),
      bytes,
      truncated,
      downloadTruncated,
    }
    return { content, details, ...(res.ok ? {} : { isError: true }) }
  } catch (e) {
    const aborted = timeoutController.signal.aborted
    const message = aborted ? `Request timed out after ${cfg.timeoutMs}ms` : errorMessage(e)
    return err(`Failed to fetch ${input.url}: ${message}`)
  } finally {
    clearTimeout(timer)
  }
}
