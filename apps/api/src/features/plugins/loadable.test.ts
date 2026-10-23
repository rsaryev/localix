import { describe, expect, test } from 'bun:test'
import { pluginLoadBlockReason } from './loadable'
import { MINI_APP_API_VERSION } from './contracts-base'
import type { DiscoveredPlugin } from './discovery'

/**
 * `validatePlugin` has always reported an incompatible `apiVersion` — into the Settings list, where
 * nothing acted on it. The load loop skipped only a fatal manifest error, so an ENABLED plugin
 * declaring an API this host does not implement was imported anyway: its `register()` ran and its
 * tools, skills, agents and prompt sections were contributed, then it failed in whatever way its
 * missing contract happened to fail. This is the gate that makes the validator's sentence true.
 */
const plugin = (over: {
  apiVersion?: number
  error?: string
  manifestRecovered?: boolean
}): DiscoveredPlugin =>
  ({
    dir: '/plugins/x',
    scope: 'bundled',
    projectId: '',
    manifest: { name: 'x', version: '1.0.0', apiVersion: over.apiVersion },
    provides: {},
    error: over.error,
    manifestRecovered: over.manifestRecovered,
  }) as unknown as DiscoveredPlugin

describe('pluginLoadBlockReason', () => {
  test('refuses a plugin that targets a newer API than the host implements', () => {
    const reason = pluginLoadBlockReason(plugin({ apiVersion: MINI_APP_API_VERSION + 1 }))
    expect(reason).toContain(`targets API v${MINI_APP_API_VERSION + 1}`)
    expect(reason).toContain(`this host implements v${MINI_APP_API_VERSION}`)
  })

  test('allows the host version and anything older', () => {
    expect(pluginLoadBlockReason(plugin({ apiVersion: MINI_APP_API_VERSION }))).toBeNull()
    if (MINI_APP_API_VERSION > 1)
      expect(pluginLoadBlockReason(plugin({ apiVersion: MINI_APP_API_VERSION - 1 }))).toBeNull()
  })

  test('allows a manifest with no apiVersion at all', () => {
    // Assumed compatible, exactly as `checkApiVersion` assumes when it only warns: refusing legacy
    // manifests would break every plugin written before the field existed.
    expect(pluginLoadBlockReason(plugin({}))).toBeNull()
  })

  test('still refuses a fatal manifest error, and reports that error verbatim', () => {
    expect(pluginLoadBlockReason(plugin({ error: 'plugin.json is not valid JSON' }))).toBe(
      'plugin.json is not valid JSON',
    )
  })

  test('a RECOVERED manifest is not blocked — graceful degradation is preserved', () => {
    // Its error was coerced to a non-fatal warning and a usable manifest loaded; blocking it here
    // would turn a warning back into a hard failure.
    expect(
      pluginLoadBlockReason(plugin({ error: 'unknown field ignored', manifestRecovered: true })),
    ).toBeNull()
  })

  test('a fatal manifest error wins over the version check', () => {
    // Order matters for the message: "not valid JSON" is actionable, while a version parsed out of a
    // broken manifest is not trustworthy enough to report as the cause.
    expect(
      pluginLoadBlockReason(plugin({ error: 'broken', apiVersion: MINI_APP_API_VERSION + 5 })),
    ).toBe('broken')
  })
})
