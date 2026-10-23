import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { CapabilitySnapshot } from '@/shared/api/contracts'
import { __resetMiniAppContrib, refetchMiniAppContrib } from '@/shared/contrib/enabledMiniApps'
import {
  areMiniAppContributionsPending,
  miniAppContributionActivation,
} from '@/shared/contrib/miniAppActivation'
import { __resetMiniAppUiLoads } from '@/shared/contrib/miniAppUiLoads'
import { __setRegistryFlushScheduler } from '@/shared/contrib/registryChanges'
import { isUnavailableContributedKind } from './capabilities'

/**
 * A mini app whose UI artifact failed to import used to count as settled, so once activation was
 * authoritative its restored tabs read as unavailable and were closed, and the pruned grid was
 * saved: a transient 503 while the sidecar restarted deleted them for good. The grid's gate is
 * checked here, in the layer that owns it, against the contrib store's real state.
 */
const withUi = (name: string) =>
  ({ name, enabled: true, ui: { entry: `/ui/${name}.js`, styles: [], revision: 'r1' } }) as never

const snapshot = (miniApps: never[]): CapabilitySnapshot =>
  ({ revision: 1, scope: { projectId: '', agentId: null }, miniApps, views: [] }) as never

beforeEach(() => __setRegistryFlushScheduler(() => () => {}))
afterEach(() => {
  __resetMiniAppContrib()
  __resetMiniAppUiLoads()
  __setRegistryFlushScheduler(null)
})

describe('a restored mini app tab over a failed UI import', () => {
  test('is kept, not closed as unavailable', async () => {
    await refetchMiniAppContrib(
      { loadSnapshot: async () => snapshot([withUi('git')]) },
      async (_miniApps, settled) => settled?.('git', false),
    )
    // Every other gate is authoritative, but the kind may still be git's: nothing is closed.
    expect(areMiniAppContributionsPending()).toBe(true)
    expect(miniAppContributionActivation('git')).toBe('pending')
    expect(isUnavailableContributedKind('git:panel')).toBe(false)
  })
})
