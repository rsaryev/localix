import { describe, expect, test } from 'bun:test'
import { miniAppLoadBlockReason } from './loadable'
import { MINI_APP_API_VERSION } from './contracts-base'
import type { DiscoveredMiniApp } from './folder'

/**
 * A manifest's incompatible `apiVersion` used to be reported only in the Settings list, where
 * nothing acted on it: an ENABLED mini app declaring an API this host does not implement was
 * imported anyway, its `register()` ran and its tools and prompt sections were contributed, then
 * it failed in whatever way its missing contract happened to fail. This is the gate that refuses it.
 */
const app = (over: { apiVersion?: number; error?: string }): DiscoveredMiniApp =>
  ({
    name: 'x',
    dir: '/mini-apps/x',
    scope: 'global',
    projectId: '',
    manifest: { name: 'x', version: '1.0.0', apiVersion: over.apiVersion },
    backendEntries: [],
    views: [],
    promptSections: [],
    contributions: [],
    commands: [],
    error: over.error,
  }) as unknown as DiscoveredMiniApp

describe('miniAppLoadBlockReason', () => {
  test('refuses a mini app that targets a newer API than the host implements', () => {
    const reason = miniAppLoadBlockReason(app({ apiVersion: MINI_APP_API_VERSION + 1 }))
    expect(reason).toContain(`targets API v${MINI_APP_API_VERSION + 1}`)
    expect(reason).toContain(`this host implements v${MINI_APP_API_VERSION}`)
  })

  test('allows the host version and anything older', () => {
    expect(miniAppLoadBlockReason(app({ apiVersion: MINI_APP_API_VERSION }))).toBeNull()
    if (MINI_APP_API_VERSION > 1)
      expect(miniAppLoadBlockReason(app({ apiVersion: MINI_APP_API_VERSION - 1 }))).toBeNull()
  })

  test('allows a manifest with no apiVersion at all', () => {
    // Assumed compatible: refusing such manifests would break every mini app written before the
    // field existed.
    expect(miniAppLoadBlockReason(app({}))).toBeNull()
  })

  test('still refuses a manifest error, and reports that error verbatim', () => {
    expect(miniAppLoadBlockReason(app({ error: 'mini-app.json is not valid JSON' }))).toBe(
      'mini-app.json is not valid JSON',
    )
  })

  test('a manifest error wins over the version check', () => {
    // Order matters for the message: "not valid JSON" is actionable, while a version parsed out of a
    // broken manifest is not trustworthy enough to report as the cause.
    expect(
      miniAppLoadBlockReason(app({ error: 'broken', apiVersion: MINI_APP_API_VERSION + 5 })),
    ).toBe('broken')
  })
})
