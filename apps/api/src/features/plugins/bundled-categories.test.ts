import { expect, test } from 'bun:test'

import { PLUGIN_CATEGORIES } from '@localixai/plugin-sdk/manifest'
import { assertNotVoid } from '../../lib/source-lint'
import { discoverBundledPlugins } from './discovery'

// Read through discovery, as the launcher reads them: the category lives in a mini app's
// `.localix-app/app.json`, and this test once read a root `plugin.json` no bundled folder has any
// more, so it checked nothing and passed.
test('every bundled plugin declares one supported launcher category', async () => {
  const plugins = await discoverBundledPlugins()
  assertNotVoid(
    'bundled plugins',
    plugins.length,
    'discoverBundledPlugins() reads the bundled root — check its location and layout.',
  )
  const supported: readonly string[] = PLUGIN_CATEGORIES
  const unsupported = plugins
    .filter((plugin) => !supported.includes(plugin.manifest.category ?? ''))
    .map((plugin) => `${plugin.manifest.name}: ${plugin.manifest.category ?? 'no category'}`)
  expect(unsupported).toEqual([])
})
