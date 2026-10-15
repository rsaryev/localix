/**
 * THE provider-HTTP error: its NAME, and the MESSAGE SHAPE the status is read back out of.
 *
 * Both are bare strings, and both are load-bearing contracts with `classifyAgentError`:
 *
 *   1. NAME. The classifier branches on `error.name === 'FetchError'` — and that branch is
 *      where a 429 becomes retryable, a 5xx warrants provider failover, and a 400/413 that
 *      names the context window becomes `shouldCompress` (send less history and retry) instead
 *      of a dead end. An error that misses the branch by one character is a plain `fatal`:
 *      the turn dies where it would have recovered.
 *
 *   2. MESSAGE SHAPE. `extractProviderStatus` scrapes the status back out of the
 *      `<label> <status>:` position (never any other number in the text) because runtime
 *      adapters can expose HTTP-like failures without leaking their concrete transport
 *      classes into the host. The structural
 *      `"<provider> <status>: <body>"` shape is the adapter-neutral boundary.
 */

/**
 * The `name` every provider-HTTP error carries — the string, and the ONLY string,
 * `classifyAgentError` recognizes a provider rejection by.
 *
 * Historical, and deliberately kept: renaming it is a silent, repo-wide behavior change
 * (every provider rejection would fall through to non-retryable `fatal`), so the name is
 * cheap to keep and expensive to "clean up".
 */
export const PROVIDER_HTTP_ERROR_NAME = 'FetchError'

/**
 * True when `error` is a provider-HTTP rejection — i.e. the thing the classifier's status
 * branch is for. Matched by NAME rather than by class because adapter errors cross a package
 * boundary where a shared concrete class and `instanceof` cannot be relied on.
 */
export function isProviderHttpError(error: unknown): error is Error {
  return error instanceof Error && error.name === PROVIDER_HTTP_ERROR_NAME
}

/**
 * The message shape `extractProviderStatus` parses: `"<provider>[ (<model>)][ <status>]: <body>"`.
 *
 * The status is embedded on purpose — it is how it reaches the classifier at all. A falsy
 * status (unknown, or a mid-stream error with no HTTP code) is omitted rather than printed
 * as `0`, so the scrape finds no status instead of a fake one.
 */
export function providerHttpErrorMessage(
  provider: string,
  status: number | undefined,
  body: string,
  model?: string,
): string {
  const label = `${provider}${model ? ` (${model})` : ''}${status ? ` ${status}` : ''}`
  return `${label}: ${body}`
}

export {
  attachProviderResponse,
  providerResponseOf,
  type ProviderResponseFacts,
} from './provider-response'
export { providerRetryDelayMs, MAX_TRUSTED_RETRY_DELAY_MS } from './provider-retry-delay'
