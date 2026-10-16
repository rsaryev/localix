import { useEffect, useSyncExternalStore } from 'react'
import { isDesktop, IS_MAC } from '@localixai/kit/environment'
import { tauriInvoke } from '@/shared/lib/tauri'

/**
 * The agent island switch (Settings → Preferences → Agent island, and the onboarding tip).
 * The desktop shell owns the value (`island_enabled` / `set_island_enabled`); this mirrors it
 * once per window so every surface showing the switch agrees. Off until the person turns it on.
 */
let supported = isDesktop && IS_MAC
let enabled: boolean | null = null
let loading = false
const listeners = new Set<() => void>()

function emit(next: boolean | null): void {
  enabled = next
  for (const listener of listeners) listener()
}

function load(): void {
  if (!supported || loading || enabled !== null) return
  loading = true
  void tauriInvoke()?.('island_enabled')
    .then((value) => {
      if (typeof value === 'boolean') emit(value)
    })
    .catch(() => {})
    .finally(() => {
      loading = false
    })
}

/** Turn the island on (it shows now) or off (it hides now), like the Settings switch. */
export function setIslandEnabled(next: boolean): void {
  if (!supported || enabled === next) return
  const previous = enabled
  emit(next)
  void tauriInvoke()?.('set_island_enabled', { enabled: next }).catch(() => emit(previous))
}

/** The switch's value, or null outside the macOS desktop app and until the shell answers. */
export function useIslandEnabled(): boolean | null {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => (supported ? enabled : null),
    () => null,
  )
  useEffect(load, [])
  return value
}

/** Whether this window can show the island switch at all (the macOS desktop app). */
export function islandSupported(): boolean {
  return supported
}

/** Test seam: pretend to be (or not be) the macOS desktop app, and forget the mirrored value. */
export function __resetIslandSetting(platformSupported = isDesktop && IS_MAC): void {
  supported = platformSupported
  enabled = null
  loading = false
  for (const listener of listeners) listener()
}
