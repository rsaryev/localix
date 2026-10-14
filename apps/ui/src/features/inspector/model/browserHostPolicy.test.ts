import { expect, test } from 'bun:test'
import { shouldMountBrowserHost } from './browserHostPolicy'

test('native browser agent control stays available without local preview hosts', () => {
  expect(shouldMountBrowserHost(true, false)).toBe(true)
  expect(shouldMountBrowserHost(true, true)).toBe(true)
  expect(shouldMountBrowserHost(false, true)).toBe(true)
  expect(shouldMountBrowserHost(false, false)).toBe(false)
})
