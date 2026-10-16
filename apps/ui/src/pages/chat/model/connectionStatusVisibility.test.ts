import { describe, expect, test } from 'bun:test'

import { shouldShowConnectionStatus } from './connectionStatusVisibility'

describe('workspace connection status visibility', () => {
  test('covers the pre-hydration window', () => {
    expect(shouldShowConnectionStatus(false, undefined)).toBe(true)
    expect(shouldShowConnectionStatus(false, 'starting')).toBe(true)
  })

  test('stays out of the way once the workspace is live', () => {
    expect(shouldShowConnectionStatus(true, undefined)).toBe(false)
    expect(shouldShowConnectionStatus(true, 'starting')).toBe(false)
    expect(shouldShowConnectionStatus(true, 'ready')).toBe(false)
  })

  test('surfaces a runtime that died AFTER the workspace hydrated', () => {
    // `sidecar.rs` reports an owned runtime's exit, so this state is reachable
    // mid-session. Gating the strip on `!hasHydrated` alone meant the app simply
    // stopped answering — no explanation, no restart affordance.
    expect(shouldShowConnectionStatus(true, 'error')).toBe(true)
  })
})
