import { beforeEach } from 'bun:test'

const GUARDED = Symbol.for('localix.test.networkGuard')

let installed = false

/** Whether this process loaded the UI preload. A run from the repository root does not. */
export const networkGuardInstalled = (): boolean => installed

type Fetch = typeof globalThis.fetch

function requestUrl(input: Parameters<Fetch>[0]): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/** Only in-memory schemes may pass; anything that would open a socket fails fast. */
function isOffline(url: string): boolean {
  return /^(data|blob):/i.test(url)
}

/** Wrap `fetchImpl` so only in-memory schemes pass; a fetch that is already guarded is returned
 *  unchanged. */
export function guard(fetchImpl: Fetch): Fetch {
  if ((fetchImpl as unknown as Record<symbol, boolean>)[GUARDED]) return fetchImpl
  const guarded = ((input: Parameters<Fetch>[0], init?: RequestInit) => {
    const url = requestUrl(input)
    if (isOffline(url)) return fetchImpl(input, init)
    return Promise.reject(
      new Error(
        `[test network guard] unmocked fetch to ${url}. ` +
          'Mock the client (spyOn(backendClient, …)) or globalThis.fetch in this test.',
      ),
    )
  }) as Fetch
  Object.defineProperty(guarded, GUARDED, { value: true })
  return guarded
}

/** happy-dom binds its window's `fetch` per registration and `registerDom()` copies it onto
 *  `globalThis` in a file's `beforeAll`, so guard it before each test. Only Bun's and
 *  happy-dom's own implementations are wrapped; a test that assigns a fetch of its own keeps it. */
function guardDomFetch(): void {
  const current = globalThis.fetch
  if (typeof current === 'function' && current.name === 'bound fetch') {
    globalThis.fetch = guard(current)
  }
}

/**
 * Make an unmocked network request fail fast with the URL instead of a late
 * `ECONNREFUSED` (or, worse, a silent pass against a dev API that happens to be running).
 */
export function installNetworkGuard(): void {
  installed = true
  globalThis.fetch = guard(globalThis.fetch)
  beforeEach(guardDomFetch)
}
