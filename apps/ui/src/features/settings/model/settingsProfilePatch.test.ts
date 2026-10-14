test('merging a peer commit preserves local changes and removals without retaining stale keys', async () => {
  const { mergeSettingDelta } = await import('./settingsProfilePatch')
  const committed: Record<string, unknown> = {
    fontSize: 'lg',
    fontFamily: 'geist',
    keymapPreset: 'default',
  }
  const visible: Record<string, unknown> = { fontFamily: 'inter', keymapPreset: 'old' }
  const merged = mergeSettingDelta(committed, visible, { fontSize: null, fontFamily: 'inter' })
  expect(merged).toEqual({ fontFamily: 'inter', keymapPreset: 'default' })
  expect(committed).toEqual({ fontSize: 'lg', fontFamily: 'geist', keymapPreset: 'default' })
})
import { expect, test } from 'bun:test'
