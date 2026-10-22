/**
 * The pieces every browser sign-in shares: a PKCE pair, a one-shot loopback server the provider
 * redirects to, and a race between that redirect and a pasted redirect URL for when the browser
 * cannot reach this computer.
 *
 * The server also answers the Codex CLI's `/cancel` route, so a newer login frees a port an older
 * one still holds.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import type { RuntimeAuthInteraction } from '@localixai/agent/runtime'

import { oauthErrorHtml, oauthSuccessHtml } from './oauth-page'

function base64url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken()
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(hash)) }
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

function html(response: ServerResponse, status: number, page: string): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(page)
}

/** Settles once; later outcomes are ignored. */
function oneOutcome<T>() {
  const { promise, resolve, reject } = Promise.withResolvers<T | undefined>()
  // Nobody may be waiting yet when it fails.
  promise.catch(() => undefined)
  let open = true
  return {
    promise,
    get open() {
      return open
    },
    succeed(value: T | undefined) {
      if (!open) return false
      open = false
      resolve(value)
      return true
    },
    fail(error: Error) {
      if (!open) return false
      open = false
      reject(error)
      return true
    },
  }
}

const isFromBrowser = (request: IncomingMessage) =>
  request.headers.origin !== undefined || request.headers['sec-fetch-site'] !== undefined

const LOGIN_CANCELLED = 'Login cancelled'

export async function startCallbackServer<T>(
  options: CallbackServerOptions<T>,
): Promise<CallbackServer<T>> {
  const { providerName, signal } = options
  if (signal?.aborted) throw new Error(LOGIN_CANCELLED)

  const outcome = oneOutcome<T>()
  // Set once a redirect with a code is being completed; from then on only that redirect decides.
  let completing = false
  let deadline: ReturnType<typeof setTimeout> | undefined
  const onAbort = () => end(new Error(LOGIN_CANCELLED))
  const cleanUp = () => {
    clearTimeout(deadline)
    signal?.removeEventListener('abort', onAbort)
  }
  const end = (result: Error | { value: T | undefined }) => {
    const changed = result instanceof Error ? outcome.fail(result) : outcome.succeed(result.value)
    if (changed) cleanUp()
  }

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const isGet = request.method === 'GET'
    // A newer login (ours or the Codex CLI's) asks over plain HTTP. A browser's request — a web page
    // loading this address to break a sign-in — names its origin, and is refused.
    if (
      options.cancel &&
      isGet &&
      url.pathname === options.cancel.path &&
      !isFromBrowser(request)
    ) {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Cancelled', () => server.close())
      end(new Error(options.cancel.message))
      return
    }
    if (!isGet || url.pathname !== options.path) {
      return html(response, 404, oauthErrorHtml('Callback route not found.'))
    }
    const params = url.searchParams
    if (options.state !== undefined && params.get('state') !== options.state) {
      return html(response, 400, oauthErrorHtml('State mismatch.'))
    }
    if (completing || !outcome.open) {
      return html(response, 409, oauthErrorHtml('This sign-in has already been handled.'))
    }
    const refused = params.get('error')
    if (refused) {
      const reason = params.get('error_description') ?? refused
      html(response, 400, oauthErrorHtml(`${providerName} authorization failed.`, reason))
      end(new Error(`${providerName} authorization failed: ${reason}`))
      return
    }
    if (!params.get('code'))
      return html(response, 400, oauthErrorHtml('Missing authorization code.'))

    completing = true
    let value: T
    try {
      value = await options.complete(params)
    } catch (thrown) {
      const failure = thrown instanceof Error ? thrown : new Error(String(thrown))
      html(response, 502, oauthErrorHtml(`${providerName} sign-in failed.`, failure.message))
      end(failure)
      return
    }
    const done = `Signed in to ${providerName}. You may now close this page.`
    html(response, 200, oauthSuccessHtml(done))
    end({ value })
  }

  const server = createServer((request, response) => void handle(request, response))
  await new Promise<void>((resolve, reject) => {
    const failToListen = (error: Error) => reject(error)
    server.once('error', failToListen)
    server.listen(options.port, options.host, () => {
      server.off('error', failToListen)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('OAuth callback server did not bind to TCP')
  }

  server.on('error', (error) => end(error))
  signal?.addEventListener('abort', onAbort, { once: true })
  if (options.timeoutMs !== undefined) {
    const timedOut = new Error(`${providerName} sign-in timed out`)
    deadline = setTimeout(() => end(timedOut), options.timeoutMs)
  }

  const host = options.redirectHost ?? options.host
  const authority = host.includes(':') ? `[${host}]` : host
  return {
    redirectUri: `http://${authority}:${address.port}${options.path}`,
    wait: () => outcome.promise,
    cancel() {
      if (!completing) end({ value: undefined })
    },
    close() {
      end(new Error('OAuth callback server closed'))
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
  const withdraw = new AbortController()
  const promptSignal = interaction.signal
    ? AbortSignal.any([withdraw.signal, interaction.signal])
    : withdraw.signal
  let promptFailure: Error | undefined
  // Whatever the person does with the prompt, the browser is no longer awaited.
  const typed = interaction.prompt({ type: 'manual-code', ...prompt, signal: promptSignal }).then(
    (input) => {
      callback?.cancel()
      return input
    },
    (error: unknown) => {
      promptFailure = error instanceof Error ? error : new Error(String(error))
      callback?.cancel()
      return undefined
    },
  )
  try {
    const redirected = callback ? await callback.wait() : undefined
    if (promptFailure) throw promptFailure
    if (redirected !== undefined) return { type: 'callback', value: redirected }
    const input = await typed
    if (promptFailure) throw promptFailure
    return { type: 'pasted', input: input ?? '' }
  } finally {
    withdraw.abort()
  }
}

type PastedAuthorization = { code?: string; state?: string; params?: URLSearchParams }

function fromParams(params: URLSearchParams): PastedAuthorization {
  const code = params.get('code')
  const state = params.get('state')
  return { ...(code ? { code } : {}), ...(state ? { state } : {}), params }
}

function asUrl(value: string): URL | undefined {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

/** The `code` (and `state`) of a pasted redirect URL, query string or bare code. */
export function parsePastedAuthorization(input: string): PastedAuthorization {
  const value = input.trim()
  if (value === '') return {}
  const url = asUrl(value)
  if (url) return fromParams(url.searchParams)
  if (value.includes('code=')) return fromParams(new URLSearchParams(value))
  if (value.includes('#')) {
    // `code#state`, as some providers show it for copying.
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
  const { request } = await import('node:http')
  await new Promise<void>((resolve) => {
    const asked = request({ host: '127.0.0.1', port, path, method: 'GET', timeout: 1_000 })
    asked.once('response', (response) => {
      response.resume()
      response.once('end', resolve)
    })
    asked.once('timeout', () => {
      asked.destroy()
      resolve()
    })
    asked.once('error', () => resolve())
    asked.end()
  })
}
