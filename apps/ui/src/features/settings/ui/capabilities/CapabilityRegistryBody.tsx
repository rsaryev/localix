import type { ReactNode } from 'react'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { SettingRegistryList, shouldShowRegistryEmptyState } from '../settingRegistry'

/**
 * The four-state body every capability registry shows: first load, a settled
 * empty registry, the rows, and — the state that is easy to lose — nothing at
 * all.
 *
 * That last arm is why this is shared rather than re-typed per tab. A registry
 * that failed to load has an empty list but is NOT empty; saying "no plugins
 * here yet" under a load error tells the user their plugins are gone. Five tabs each restated the same nested ternary to avoid
 * that, which is five chances to get it wrong. `shouldShowRegistryEmptyState`
 * already owned the rule — this owns the shape it decides.
 */
export function CapabilityRegistryBody({
  count,
  loading,
  error,
  empty,
  list = true,
  children,
}: {
  /** Records currently held for this scope. */
  count: number
  loading: boolean
  /** Load failure, if any. It is reported above this body, never inside it. */
  error: string | null
  /** The "nothing here yet" copy, shown only once the load has settled clean. */
  empty: ReactNode
  /**
   * Whether to wrap the rows in the list itself.
   *
   * `false` for a registry that groups its rows under headings and therefore places one
   * list per group: a heading is not a list item, and putting it inside `role="list"` would
   * make the grouping invisible to a screen reader while still reading as a row. The
   * four-state decision above stays here either way, which is the whole point of sharing it.
   */
  list?: boolean
  /** The rendered rows. */
  children: ReactNode
}) {
  if (loading && count === 0) return <LoadingHint />
  if (shouldShowRegistryEmptyState({ count, loading, error })) return <EmptyHint>{empty}</EmptyHint>
  if (count === 0) return null
  return list ? <SettingRegistryList>{children}</SettingRegistryList> : <>{children}</>
}
