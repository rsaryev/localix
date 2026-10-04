import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

test('plugin viewlets refresh with the capability activation set', () => {
  const hook = readFileSync(new URL('./useRailActions.ts', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../ui/ChatPage.tsx', import.meta.url), 'utf8')

  expect(hook).toContain('railViewletRegistry.list().map')
  expect(hook).toMatch(
    /useSyncExternalStore\(\s*subscribePluginActivation,\s*pluginActivationVersion\s*\)/u,
  )
  expect(hook).toContain('[activationVersion, capabilityScope, openSessionId]')
  expect(hook).toContain("'use no memo'")
  expect(page).toContain('useRailActions({\n    pluginViews,\n    capabilityScope,')
})
