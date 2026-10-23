import { expect, test } from 'bun:test'

import { MINI_APP_CATEGORIES } from '@localixai/mini-app-sdk/manifest'
import { assertNotVoid } from '../../lib/source-lint'
import { discoverBundledMiniApps } from './discovery'

// Read through discovery, as the launcher reads them: the category lives in a mini app's
// `.localix-app/app.json`, and this test once read a root `plugin.json` no bundled folder has any
// more, so it checked nothing and passed.
test('every bundled plugin declares one supported launcher category', async () => {
  const plugins = await discoverBundledMiniApps()
  assertNotVoid(
    'bundled plugins',
    plugins.length,
    'discoverBundledMiniApps() reads the bundled root — check its location and layout.',
  )
  const supported: readonly string[] = MINI_APP_CATEGORIES
  const unsupported = plugins
    .filter((plugin) => !supported.includes(plugin.manifest.category ?? ''))
    .map((plugin) => `${plugin.manifest.name}: ${plugin.manifest.category ?? 'no category'}`)
  expect(unsupported).toEqual([])
})
