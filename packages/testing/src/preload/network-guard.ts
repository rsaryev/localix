// Tests never reach the real network. A request to a remote host is a test that passes or fails
// with the weather, and leaks whatever it sends; it fails here, at once, naming the URL. Loopback
// stays open for integration tests that start a local server. Stub `fetch` in the test (see
// apps/api/src/testing/fetch-stub.ts), or wrap a deliberate live call in `allowNetwork`.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])
const realFetch = globalThis.fetch
let allowed = 0

function targetUrl(input: Parameters<typeof fetch>[0]): URL | undefined {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  try {
    return new URL(raw)
  } catch {
    return undefined
  }
}

const guarded = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = targetUrl(input)
  if (
    allowed === 0 &&
    url &&
    /^(?:https?|wss?):$/u.test(url.protocol) &&
    !LOOPBACK.has(url.hostname)
  )
    return Promise.reject(
      new Error(`Unmocked network request in a test: ${url.href}. Stub fetch for this test.`),
    )
  return realFetch(input, init)
}) as typeof fetch
Object.assign(guarded, realFetch)
globalThis.fetch = guarded

/** Run `fn` with the real network allowed, for a test that deliberately talks to a live service. */
export async function allowNetwork<T>(fn: () => Promise<T>): Promise<T> {
  allowed += 1
  try {
    return await fn()
  } finally {
    allowed -= 1
  }
}
