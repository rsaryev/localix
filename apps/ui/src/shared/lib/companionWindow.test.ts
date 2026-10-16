import { expect, test } from 'bun:test'
import { supportsAgentIsland } from './companionWindow'

test('only macOS desktop can enter the island shell', () => {
  expect(supportsAgentIsland(true, 'mac')).toBe(true)
  for (const os of ['windows', 'linux', 'unknown'] as const)
    expect(supportsAgentIsland(true, os)).toBe(false)
})

test('the browser keeps a content preview without native island commands', () => {
  for (const os of ['mac', 'windows', 'linux', 'unknown'] as const)
    expect(supportsAgentIsland(false, os)).toBe(true)
})
