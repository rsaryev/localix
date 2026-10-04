import { describe, expect, test } from 'bun:test'

import { isPluginRailViewlet } from './railViewletProvenance'

describe('rail viewlet provenance', () => {
  test('keeps core contributions in Views and stamped contributions in Plugins', () => {
    expect(isPluginRailViewlet({})).toBe(false)
    expect(isPluginRailViewlet({ pluginName: 'sample-plugin' })).toBe(true)
  })
})
