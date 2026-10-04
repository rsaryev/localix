import type { UiAnchorOverlayParam } from '@localixai/plugin-sdk/ui'

export interface UiOverlayRequest {
  id: string
  params: Readonly<Record<string, UiAnchorOverlayParam>>
}

type UiOverlayListener = (params: UiOverlayRequest['params']) => void

const listeners = new Map<string, Set<UiOverlayListener>>()

/**
 * Request a transient UI surface without coupling navigation to its React owner.
 * Opening is user-initiated and read-only; the overlay remains responsible for
 * any later selection or mutation confirmation.
 */
export function openUiOverlay(
  id: string,
  params: Readonly<Record<string, UiAnchorOverlayParam>> = {},
): void {
  if (!id) return
  const owned = listeners.get(id)
  if (!owned || owned.size === 0) {
    // A request with no listener is dropped — that is the contract, and it is the right one for a
    // transient surface. What it must not be is INVISIBLE: the sources drawer spent a release
    // doing nothing when clicked, because its owner was mounted behind a focus gate and the click
    // reached no one. There was no error, no drawer, and nothing in the console to look at.
    //
    // Silent only in a PRODUCTION BUILD. Written first as `if (import.meta.env?.DEV)`, which is
    // falsy under `bun test` — the warning could not be exercised anywhere it could be checked,
    // which is how a guard ships as decoration. Negating PROD warns in dev and in tests, and stays
    // quiet where a stray request is merely harmless noise.
    if (!import.meta.env?.PROD) {
      console.warn(
        `[ui-overlay] "${id}" was requested with no listener mounted — the request was dropped. ` +
          'Its owner is probably behind a conditional mount; an overlay opened from anywhere must ' +
          'be owned by an always-mounted component (or write a store instead of the bus).',
      )
    }
    return
  }
  owned.forEach((listener) => listener(params))
}

/** Subscribe only the mounted owner of one overlay id. */
export function subscribeUiOverlay(id: string, listener: UiOverlayListener): () => void {
  let owned = listeners.get(id)
  if (!owned) {
    owned = new Set()
    listeners.set(id, owned)
  }
  owned.add(listener)
  return () => {
    owned?.delete(listener)
    if (owned?.size === 0) listeners.delete(id)
  }
}
