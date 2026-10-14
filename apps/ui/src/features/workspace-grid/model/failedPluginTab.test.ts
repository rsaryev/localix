import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { CapabilitySnapshot } from '@/shared/api/contracts'
import { __resetPluginContrib, refetchPluginContrib } from '@/shared/contrib/enabledPlugins'
import {
  arePluginContributionsPending,
  pluginContributionActivation,
} from '@/shared/contrib/pluginActivation'
import { __resetPluginUiLoads } from '@/shared/contrib/pluginUiLoads'
import { __setRegistryFlushScheduler } from '@/shared/contrib/registryChanges'
import { isUnavailableContributedKind } from './capabilities'

/**
 * A plugin whose UI artifact failed to import used to count as settled, so once activation was
 * authoritative its restored tabs read as unavailable and were closed, and the pruned grid was
 * saved: a transient 503 while the sidecar restarted deleted them for good. The grid's gate is
 * checked here, in the layer that owns it, against the contrib store's real state.
 */
const withUi = (name: string) =>
  ({ name, enabled: true, ui: { entry: `/ui/${name}.js`, styles: [], revision: 'r1' } }) as never

const snapshot = (plugins: never[]): CapabilitySnapshot =>
  ({ revision: 1, scope: { projectId: '', agentId: null }, plugins, views: [] }) as never

beforeEach(() => __setRegistryFlushScheduler(() => () => {}))
afterEach(() => {
  __resetPluginContrib()
  __resetPluginUiLoads()
  __setRegistryFlushScheduler(null)
})

describe('a restored plugin tab over a failed UI import', () => {
  test('is kept, not closed as unavailable', async () => {
    await refetchPluginContrib(
      { loadSnapshot: async () => snapshot([withUi('git')]) },
      async (_plugins, settled) => settled?.('git', false),
    )
    // Every other gate is authoritative, but the kind may still be git's: nothing is closed.
    expect(arePluginContributionsPending()).toBe(true)
    expect(pluginContributionActivation('git')).toBe('pending')
    expect(isUnavailableContributedKind('git:panel')).toBe(false)
  })
})
