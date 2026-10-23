/**
 * Translating the flat, model-facing `HttpRequestInput` into the structured `RequestSpec` the
 * rest of the mini app speaks. Pure — the one place the flat/structured impedance mismatch lives,
 * so neither the schema nor the sender has to know about the other's shape.
 *
 * Runs AFTER `httpRequestProblem()`, so it may assume the well-formedness that helper enforces
 * and fall back to defaults for everything it doesn't.
 */

import type { HttpRequestInput, PairInput } from './http-request-schema'
import {
  parseMethod,
  type Pair,
  type RequestAuth,
  type RequestBody,
  type RequestSpec,
} from './request-spec'

const DEFAULT_CONTENT_TYPE = 'application/json'

function pairs(input: PairInput[] | undefined): Pair[] {
  return (input ?? []).map(({ name, value, disabled }) => ({ name, value, disabled }))
}

export function authFromInput(input: HttpRequestInput): RequestAuth {
  switch (input.authType) {
    case 'basic':
      return { type: 'basic', username: input.username ?? '', password: input.password ?? '' }
    case 'bearer':
      return { type: 'bearer', token: input.token ?? '' }
    case 'apikey':
      return {
        type: 'apikey',
        key: input.apiKeyName ?? '',
        value: input.apiKeyValue ?? '',
        addTo: input.apiKeyIn ?? 'header',
      }
    // An absent authType means the model didn't ask for auth. Named alongside 'none' rather
    // than swept into a `default`, so adding an auth variant is a compile error here.
    case 'none':
    case undefined:
      return { type: 'none' }
  }
}

function bodyFromInput(input: HttpRequestInput): RequestBody | undefined {
  if (input.form?.length) {
    return { mimeType: 'application/x-www-form-urlencoded', form: pairs(input.form) }
  }
  if (typeof input.body === 'string' && input.body !== '') {
    return { mimeType: input.contentType ?? DEFAULT_CONTENT_TYPE, text: input.body }
  }
  return undefined
}

/** Build a spec from input alone — used by `save`, and by `send` without a saved base. */
export function specFromInput(input: HttpRequestInput): RequestSpec {
  return {
    url: input.url ?? '',
    method: parseMethod(input.method) ?? 'GET',
    headers: pairs(input.headers),
    query: pairs(input.query),
    body: bodyFromInput(input),
    auth: authFromInput(input),
    // Omitted rather than `[]`: most requests have no placeholders, and an empty array is a
    // field the model reads on every `get` for nothing.
    ...(input.pathParams?.length ? { pathParameters: pairs(input.pathParams) } : {}),
    followRedirects: input.followRedirects,
    timeoutMs: input.timeoutMs,
    maxRedirects: input.maxRedirects,
  }
}

/**
 * Overlay input onto a saved spec, for `send` with both a `name` and overrides.
 *
 * Fields are overridden only when PRESENT in the input — an absent field keeps the saved value.
 * That is what makes `{"action":"send","name":"github-user","query":[…]}` mean "the saved request
 * but with this query" rather than "a bare GET to the saved url with everything else lost".
 * Headers and query are MERGED (input wins on a name clash) rather than replaced, so a saved
 * `Accept` header survives an override that only adds a `X-Request-Id`.
 */
export function overlayInput(base: RequestSpec, input: HttpRequestInput): RequestSpec {
  const overrideBody = bodyFromInput(input)
  return {
    url: input.url?.trim() ? input.url : base.url,
    method: parseMethod(input.method) ?? base.method,
    headers: mergePairs(base.headers, pairs(input.headers)),
    query: mergePairs(base.query, pairs(input.query)),
    body: overrideBody ?? base.body,
    auth: input.authType ? authFromInput(input) : base.auth,
    ...(base.pathParameters?.length || input.pathParams?.length
      ? { pathParameters: mergePairs(base.pathParameters ?? [], pairs(input.pathParams)) }
      : {}),
    followRedirects: input.followRedirects ?? base.followRedirects,
    timeoutMs: input.timeoutMs ?? base.timeoutMs,
    maxRedirects: input.maxRedirects ?? base.maxRedirects,
  }
}

/** `next` wins on a case-insensitive name clash; order is base-first, then the additions. */
export function mergePairs(base: readonly Pair[], next: readonly Pair[]): Pair[] {
  if (next.length === 0) return [...base]
  const overridden = new Set(next.map((p) => p.name.toLowerCase()))
  return [...base.filter((p) => !overridden.has(p.name.toLowerCase())), ...next]
}

/**
 * The spec a `send` should use — the saved base with input overlaid, or a sentence saying why not.
 *
 * Pure, and separated from the `store.get` that feeds it, because as a closure inside
 * `createHttpRequestTool` it was untestable and therefore untested: a mutation sweep neutralised
 * both of its branches and all 898 tests stayed green. `saved` is passed in rather than fetched so
 * the "no such request" answer — the one a model reads most often, since it names the recovery —
 * can be pinned without a store, a host or a context.
 *
 * `saved` is only consulted when a `name` was given; a nameless input is a one-off built from the
 * input alone, and the caller is expected not to have hit the store at all.
 */
export function specForSend(
  input: Pick<HttpRequestInput, 'name'> & HttpRequestInput,
  /** Any stored record — only its `spec` is read, so the store's own shape stays out of here. */
  saved: { spec: RequestSpec } | null,
): RequestSpec | string {
  if (!input.name?.trim()) return specFromInput(input)
  if (!saved) {
    return `No saved request named "${input.name}". Use {"action":"list"} to see saved requests, or pass a "url" to send a one-off.`
  }
  return overlayInput(saved.spec, input)
}
