const PUBLISHER_STORAGE_KEY = 'localix.ui-locations.publisher'

/**
 * One publisher per TAB, stable across reloads of that tab. A fresh id per page load made
 * every reload a new publisher generation: the backend's per-publisher revision ordering
 * restarted, a stale-but-still-cached catalog from the previous generation could win a
 * race with the new one, and the publisher map filled with dead ids (16 per scope). Tab
 * storage is the right lifetime — it is what "the same client" means here.
 */
export function tabPublisherId(): string {
  const fresh = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `page-${Date.now()}-${Math.random().toString(36).slice(2)}`
  try {
    const stored = globalThis.sessionStorage?.getItem(PUBLISHER_STORAGE_KEY)
    if (stored && /^[a-zA-Z0-9._~-]{1,128}$/.test(stored)) return stored
    const next = fresh()
    globalThis.sessionStorage?.setItem(PUBLISHER_STORAGE_KEY, next)
    return next
  } catch {
    // Storage can be unavailable (privacy mode, a detached worker); a per-load id still works.
    return fresh()
  }
}
