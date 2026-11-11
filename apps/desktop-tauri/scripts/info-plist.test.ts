import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

/**
 * The bundle's own Info.plist keys (`src-tauri/Info.plist`) are spelled the way Apple spells them.
 *
 * A misspelt usage key is not an error anywhere: the bundler copies it, macOS ignores it, and the
 * consent alert shows no reason. `NSRemovableVolumeUsageDescription` (singular) shipped that way;
 * Apple's key is `NSRemovableVolumesUsageDescription`. Each name below was checked against
 * developer.apple.com/documentation/bundleresources/information-property-list.
 */
const APPLE_KEYS = new Set([
  'NSMicrophoneUsageDescription',
  'NSDocumentsFolderUsageDescription',
  'NSDesktopFolderUsageDescription',
  'NSDownloadsFolderUsageDescription',
  'NSRemovableVolumesUsageDescription',
  'NSNetworkVolumesUsageDescription',
  'NSFileProviderDomainUsageDescription',
  'NSAppleEventsUsageDescription',
])

test('every Info.plist key is one Apple defines', () => {
  const plist = readFileSync(new URL('../src-tauri/Info.plist', import.meta.url), 'utf8')
  const keys = [...plist.matchAll(/<key>([^<]+)<\/key>/gu)].map((match) => match[1])
  expect(keys.length).toBeGreaterThan(0)
  expect(keys.filter((key) => !APPLE_KEYS.has(key ?? ''))).toEqual([])
})
