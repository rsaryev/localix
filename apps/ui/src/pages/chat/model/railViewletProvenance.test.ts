import { describe, expect, test } from 'bun:test'

import { isMiniAppRailViewlet } from './railViewletProvenance'

describe('rail viewlet provenance', () => {
  test('keeps core contributions in Views and stamped contributions in Mini apps', () => {
    expect(isMiniAppRailViewlet({})).toBe(false)
    expect(isMiniAppRailViewlet({ miniAppName: 'sample-mini-app' })).toBe(true)
  })
})
