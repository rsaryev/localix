/** How long a preview's server has to answer before the check gives up. */
export const PING_TIMEOUT_MS = 2_000

/**
 * One liveness question, asked of the SERVER and not of this browser's disk cache.
 *
 * `no-cors` reaches a cross-origin dev server without CORS headers — the only thing read is
 * whether the request resolves at all. `no-store` is the part that had to be added: a static
 * dev server sends no cache headers, so the ping was answered heuristically from cache long
 * after the port closed. The preview kept reading as running, its overlay never came, and
 * remounting the iframe repainted the same cached document — a killed server still showing
 * its app, reload included.
 *
 * Its own module because the answer is not React's: the pane asks it on mount, on a poll and
 * before a reload, and a future server-pushed liveness replaces the caller, not the question.
 */
export function pingPreviewUrl(url: string): Promise<boolean> {
  return fetch(url, {
    mode: 'no-cors',
    cache: 'no-store',
    signal: AbortSignal.timeout(PING_TIMEOUT_MS),
  }).then(
    () => true,
    () => false,
  )
}

/** Between checks, when the client has to ask on its own. */
const POLL_INTERVAL_MS = 3_000

/**
 * The FALLBACK watch, for an endpoint the API will not watch for us (anything that is not
 * loopback or private, and any server too old to know the subscription). Visibility-gated:
 * a hidden tab asks nothing, and asks again the moment it is foregrounded, so a backgrounded
 * window never keeps knocking on someone's dev server.
 */
export function pollPreviewUrl(url: string, onResult: (alive: boolean) => void): () => void {
  let cancelled = false
  let timer: ReturnType<typeof setInterval> | null = null
  const ask = () => {
    void pingPreviewUrl(url).then((alive) => {
      if (!cancelled) onResult(alive)
    })
  }
  const start = () => {
    if (!timer) timer = setInterval(ask, POLL_INTERVAL_MS)
  }
  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      ask()
      start()
    } else stop()
  }
  ask()
  if (document.visibilityState === 'visible') start()
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    cancelled = true
    stop()
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
