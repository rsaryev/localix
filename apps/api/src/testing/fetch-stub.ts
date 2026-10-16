/**
 * TEST SUPPORT — a typed stand-in for `globalThis.fetch`.
 *
 * Tests only ever want to supply fetch's CALL signature. But `typeof fetch` is a
 * function/namespace merge: besides the call signature it carries Bun's
 * `fetch.preconnect`. So a bare `(async () => Response.json({})) as typeof fetch`
 * is a lie the compiler has to be told to swallow — and once you reach for a cast
 * there, nothing checks that the handler's arguments match fetch's at all.
 *
 * `stubFetch` takes exactly the call signature and supplies the rest of the real
 * surface, so the result IS a `typeof fetch` with no assertion anywhere. Handlers
 * keep full argument type-checking; a handler with the wrong parameter types now
 * fails to compile instead of being cast into silence.
 */
export type FetchCall = (...args: Parameters<typeof fetch>) => Promise<Response>

/** Build a fully-typed `fetch` from just its call signature. */
export function stubFetch(call: FetchCall): typeof fetch {
  const impl = (...args: Parameters<typeof fetch>) => call(...args)
  // The only member of `fetch` beyond the call signature; a stub never dials out.
  return Object.assign(impl, { preconnect: () => {} })
}

/** The URL of a stubbed call, whatever input shape (string / URL / Request) it used. */
export function fetchUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/** The text body of a stubbed call (`''` when absent or not a string body). */
export function fetchBody(init?: RequestInit): string {
  return typeof init?.body === 'string' ? init.body : ''
}
