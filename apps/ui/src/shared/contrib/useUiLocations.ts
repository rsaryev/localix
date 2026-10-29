import { useSyncExternalStore } from 'react'
import type { UiLocationDescriptor } from '@localixai/mini-app-sdk/ui'
import {
  listUiLocations,
  subscribeUiLocations,
  uiLocationRevision,
  type UiLocationAudience,
} from './uiLocations'

/** Each audience's list at the revision it was read: the same array until a location moves. */
const listed = new Map<string, { revision: number; locations: UiLocationDescriptor[] }>()

/**
 * {@link listUiLocations} as a render reads it: the list is the hook's value, read again when a
 * location is registered or removed. A list read beside a revision kept its first answer in the
 * built app, whose React Compiler memoizes on what a body reads and drops `void revision`.
 */
export function useUiLocations(exposure?: UiLocationAudience): UiLocationDescriptor[] {
  const read = () => {
    const key = exposure ?? ''
    const revision = uiLocationRevision()
    const held = listed.get(key)
    if (held?.revision === revision) return held.locations
    const locations = listUiLocations(exposure ? { exposure } : undefined)
    listed.set(key, { revision, locations })
    return locations
  }
  return useSyncExternalStore(subscribeUiLocations, read, read)
}
