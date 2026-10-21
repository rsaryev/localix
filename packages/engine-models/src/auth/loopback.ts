/**
 * The pieces every browser sign-in shares: a PKCE pair, a one-shot loopback server the provider
 * redirects to, and a race between that redirect and a pasted redirect URL for when the browser
 * cannot reach this computer.
 *
 * Ported from pi's OAuth helpers (github.com/earendil-works/pi, MIT, © Mario Zechner), with the
 * Codex CLI's `/cancel` route that lets a newer login free a port an older one still holds.
 */
import { createServer, type ServerResponse } from 'node:http'

import type { RuntimeAuthInteraction } from '@localixai/agent/runtime'

import { oauthErrorHtml, oauthSuccessHtml } from './oauth-page'

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

export interface CallbackServerOptions<T> {
  /** Named on the page the browser lands on, e.g. `OpenAI`. */
  providerName: string
  host: string
  /** `0` picks a free port. */
  port: number
  path: string
  /** Host in `redirectUri` when it differs from `host`, e.g. `localhost`. */
  redirectHost?: string
  /** Expected `state`; omit for a provider that sends none. */
  state?: string
  /** Finish the sign-in from the redirect's parameters before the browser page is sent. */
  complete: (params: URLSearchParams) => Promise<T>
  signal?: AbortSignal
  timeoutMs?: number
  /** A route through which a newer login attempt ends this one, freeing the port. */
  cancel?: { path: string; message: string }
}

export interface CallbackServer<T> {
  redirectUri: string
  /** The result of `complete`, or undefined after `cancel()`. */
  wait(): Promise<T | undefined>
  /** Stop waiting for the browser, unless its redirect is already being completed. */
  cancel(): void
  close(): void
}

function sendPage(response: ServerResponse, status: number, html: string) {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(html)
}

export async function startCallbackServer<T>(
  options: CallbackServerOptions<T>,
): Promise<CallbackServer<T>> {
  const { providerName, signal } = options
  if (signal?.aborted) throw new Error('Login cancelled')
  let resolveWait: (value: T | undefined) => void = () => {}
  let rejectWait: (error: Error) => void = () => {}
  const waiting = new Promise<T | undefined>((resolve, reject) => {
    resolveWait = resolve
    rejectWait = reject
  })
  waiting.catch(() => undefined)
  let claimed = false
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const onAbort = () => finish({ error: new Error('Login cancelled') })
  const finish = (result: { value: T | undefined } | { error: Error }) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    if ('error' in result) rejectWait(result.error)
    else resolveWait(result.value)
  }

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost')
      // A newer login (ours or the Codex CLI's) asks over plain HTTP. A browser's request — a web
      // page loading this address to break a sign-in — names its origin, and is refused.
      const fromBrowser =
        request.headers.origin !== undefined || request.headers['sec-fetch-site'] !== undefined
      if (
        options.cancel &&
        request.method === 'GET' &&
        url.pathname === options.cancel.path &&
        !fromBrowser
      ) {
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('Cancelled', () => server.close())
        finish({ error: new Error(options.cancel.message) })
        return
      }
      if (request.method !== 'GET' || url.pathname !== options.path)
        return sendPage(response, 404, oauthErrorHtml('Callback route not found.'))
      if (options.state !== undefined && url.searchParams.get('state') !== options.state)
        return sendPage(response, 400, oauthErrorHtml('State mismatch.'))
      if (claimed || settled)
        return sendPage(response, 409, oauthErrorHtml('This sign-in has already been handled.'))
      const error = url.searchParams.get('error')
      if (error) {
        const description = url.searchParams.get('error_description') ?? error
        sendPage(
          response,
          400,
          oauthErrorHtml(`${providerName} authorization failed.`, description),
        )
        finish({ error: new Error(`${providerName} authorization failed: ${description}`) })
        return
      }
      if (!url.searchParams.get('code'))
        return sendPage(response, 400, oauthErrorHtml('Missing authorization code.'))
      claimed = true
      try {
        const value = await options.complete(url.searchParams)
        sendPage(
          response,
          200,
          oauthSuccessHtml(`Signed in to ${providerName}. You may now close this page.`),
        )
        finish({ value })
      } catch (thrown) {
        const failure = thrown instanceof Error ? thrown : new Error(String(thrown))
        sendPage(response, 502, oauthErrorHtml(`${providerName} sign-in failed.`, failure.message))
        finish({ error: failure })
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('OAuth callback server did not bind to TCP')
  }
  server.on('error', (error) => finish({ error }))
  signal?.addEventListener('abort', onAbort, { once: true })
  if (options.timeoutMs !== undefined) {
    timer = setTimeout(
      () => finish({ error: new Error(`${providerName} sign-in timed out`) }),
      options.timeoutMs,
    )
  }
  const host = options.redirectHost ?? options.host
  return {
    redirectUri: `http://${host.includes(':') ? `[${host}]` : host}:${address.port}${options.path}`,
    wait: () => waiting,
    cancel: () => {
      if (!claimed) finish({ value: undefined })
    },
    close: () => {
      finish({ error: new Error('OAuth callback server closed') })
      server.close()
      // A browser keeps spare connections open; one could carry a LATER login's redirect here.
      server.closeAllConnections()
    },
  }
}

/**
 * The browser's redirect, or the redirect URL / code a person pasted because the browser could
 * not reach this computer (over SSH, on another machine). Whichever comes first.
 */
export async function callbackOrPasted<T>(
  interaction: RuntimeAuthInteraction,
  callback: CallbackServer<T> | undefined,
  prompt: { message: string; placeholder: string },
): Promise<{ type: 'callback'; value: T } | { type: 'pasted'; input: string }> {
  const stopPrompt = new AbortController()
  let promptError: Error | undefined
  const pasted = interaction
    .prompt({
      type: 'manual-code',
      ...prompt,
      signal: interaction.signal
        ? AbortSignal.any([stopPrompt.signal, interaction.signal])
        : stopPrompt.signal,
    })
    .then((input) => {
      callback?.cancel()
      return input
    })
    .catch((error: unknown) => {
      promptError = error instanceof Error ? error : new Error(String(error))
      callback?.cancel()
      return undefined
    })
  try {
    const value = await callback?.wait()
    if (promptError) throw promptError
    if (value !== undefined) return { type: 'callback', value }
    const input = await pasted
    if (promptError) throw promptError
    return { type: 'pasted', input: input ?? '' }
  } finally {
    stopPrompt.abort()
  }
}

/** The `code` (and `state`) of a pasted redirect URL, query string or bare code. */
export function parsePastedAuthorization(input: string): {
  code?: string
  state?: string
  params?: URLSearchParams
} {
  const value = input.trim()
  if (!value) return {}
  try {
    const url = new URL(value)
    return {
      ...(url.searchParams.get('code') ? { code: url.searchParams.get('code')! } : {}),
      ...(url.searchParams.get('state') ? { state: url.searchParams.get('state')! } : {}),
      params: url.searchParams,
    }
  } catch {
    // Not a URL.
  }
  if (value.includes('code=')) {
    const params = new URLSearchParams(value)
    return {
      ...(params.get('code') ? { code: params.get('code')! } : {}),
      ...(params.get('state') ? { state: params.get('state')! } : {}),
      params,
    }
  }
  if (value.includes('#')) {
    const [code, state] = value.split('#', 2)
    return { ...(code ? { code } : {}), ...(state ? { state } : {}) }
  }
  return { code: value }
}

/**
 * Ask a stale login's listener on `port` to give way through its `/cancel` route, as the Codex CLI
 * does; never throws. Plain `node:http`, so no browser headers go with it.
 */
export async function askToFreePort(port: number, path = '/cancel'): Promise<void> {
  const http = await import('node:http')
  await new Promise<void>((resolve) => {
    const request = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', timeout: 1_000 },
      (response) => {
        response.resume()
        response.once('end', resolve)
      },
    )
    request.once('timeout', () => (request.destroy(), resolve()))
    request.once('error', () => resolve())
    request.end()
  })
}
