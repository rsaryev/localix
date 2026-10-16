import { describe, expect, test } from 'bun:test'
import { pluginTrustClass } from './enable'
import { trustFallback } from '../ext/trust'
import type { DiscoveredPlugin } from './discovery'

// Minimal plugin fixture: only the fields the classification reads.
const plugin = (opts: {
  bundled: boolean
  hasNativeTools: boolean
  defaultEnabled?: boolean
}): DiscoveredPlugin =>
  ({
    bundled: opts.bundled,
    manifest: { defaultEnabled: opts.defaultEnabled },
    provides: { hasNativeTools: opts.hasNativeTools },
  }) as unknown as DiscoveredPlugin

describe('pluginTrustClass', () => {
  test('bundled code-free ships on; the manifest may opt out', () => {
    expect(pluginTrustClass(plugin({ bundled: true, hasNativeTools: false }))).toBe('bundled')
    expect(
      pluginTrustClass(plugin({ bundled: true, hasNativeTools: false, defaultEnabled: false })),
    ).toBe('opt-in')
  })

  test('bundled code-bearing asks first; the manifest may opt in', () => {
    expect(pluginTrustClass(plugin({ bundled: true, hasNativeTools: true }))).toBe('opt-in')
    expect(
      pluginTrustClass(plugin({ bundled: true, hasNativeTools: true, defaultEnabled: true })),
    ).toBe('bundled')
  })

  test('anything not bundled is untrusted, whatever its manifest claims', () => {
    // The trust boundary is the bundle boundary, and a manifest is written by whoever wrote
    // the plugin — so `defaultEnabled: true` from outside the app is not consent.
    for (const hasNativeTools of [true, false]) {
      expect(
        pluginTrustClass(plugin({ bundled: false, hasNativeTools, defaultEnabled: true })),
      ).toBe('untrusted')
      expect(pluginTrustClass(plugin({ bundled: false, hasNativeTools }))).toBe('untrusted')
    }
  })
})

describe('what a class means when no rule mentions the plugin', () => {
  test('bundled runs; the other two put the question to the user', () => {
    // `ask` and not `deny`, on purpose: the plugin is on disk because someone put it there,
    // so the honest answer is a question rather than a silent nothing — which is what an
    // unexplained "off" had been for every dropped-in plugin.
    expect(trustFallback('bundled')).toBe('allow')
    expect(trustFallback('opt-in')).toBe('ask')
    expect(trustFallback('untrusted')).toBe('ask')
  })

  test('a rule about the class settles it for every plugin in that class', () => {
    // The point of carrying the class as the rule's RESOURCE: `plugin:* untrusted allow` is
    // an ordinary row, and so is `plugin:office * allow` for one plugin. Nothing here is a
    // second mechanism — see `ext/catalog.test.ts` for the two meeting.
    expect(pluginTrustClass(plugin({ bundled: false, hasNativeTools: true }))).toBe('untrusted')
  })
})
