import { expect, test } from 'bun:test'

import { MINI_APP_CATEGORIES } from '@localixai/mini-app-sdk/manifest'
import { assertNotVoid } from '../../lib/source-lint'
import { discoverBundledMiniApps } from './discovery'

// Read through discovery, as the launcher reads them: the category lives in a mini app's
// `mini-app.json`, and this test once read a manifest no bundled folder has any more, so it
// checked nothing and passed.
test('every bundled mini app declares one supported launcher category', async () => {
  const apps = await discoverBundledMiniApps()
  assertNotVoid(
    'bundled mini apps',
    apps.length,
    'discoverBundledMiniApps() reads the bundled root — check its location and layout.',
  )
  const supported: readonly string[] = MINI_APP_CATEGORIES
  const unsupported = apps
    .filter((app) => !supported.includes(app.manifest?.category ?? ''))
    .map((app) => `${app.name}: ${app.manifest?.category ?? 'no category'}`)
  expect(unsupported).toEqual([])
})
