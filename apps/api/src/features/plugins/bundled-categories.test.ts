import { expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { pluginManifestSchema } from './contracts'

test('every bundled plugin declares one supported launcher category', () => {
  const root = resolve(import.meta.dir, '../../../../../plugins')
  const names = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(root, entry.name, 'plugin.json')))
    .map((entry) => entry.name)

  for (const name of names) {
    const manifest = pluginManifestSchema.parse(
      JSON.parse(readFileSync(resolve(root, name, 'plugin.json'), 'utf8')),
    )
    expect(manifest.category, name).toBeDefined()
  }
})
