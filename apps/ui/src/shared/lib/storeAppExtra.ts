import type { Listing } from '@localixai/store'

/**
 * A package that can also become an app of its own on this computer (a window, a Dock icon, a
 * place in Spotlight), as the Store offers it beside Install. The Store knows no package kind
 * (`docs/internals/store.md`): the feature that knows which listings qualify provides this, at
 * start-up, and the Store only asks.
 */
export interface StoreAppExtra {
  /** Whether this listing can become an app here. */
  available: (listing: Listing) => boolean
  has: (listing: Listing) => boolean
  /** Make the app; rejects with what went wrong. */
  make: (listing: Listing) => Promise<void>
  remove: (listing: Listing) => Promise<void>
}

type UseStoreAppExtra = () => StoreAppExtra | undefined

let provided: UseStoreAppExtra = () => undefined

/** Offer the hook that reads the extra; set once at start-up, before the Store renders. */
export function provideStoreAppExtra(hook: UseStoreAppExtra): void {
  provided = hook
}

/** The extra, kept current while shown; undefined where no app can be made. */
export function useStoreAppExtra(): StoreAppExtra | undefined {
  return provided()
}
