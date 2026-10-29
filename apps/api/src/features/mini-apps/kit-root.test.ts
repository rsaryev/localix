import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tempDirPerTest } from '@localixai/testing'

import { miniAppKitDirFrom } from './kit-root'

const root = tempDirPerTest('mini-app-kit-root-')
const saved = process.env.LOCALIX_MINI_APP_KIT_DIR
afterEach(() => {
  if (saved === undefined) delete process.env.LOCALIX_MINI_APP_KIT_DIR
  else process.env.LOCALIX_MINI_APP_KIT_DIR = saved
})

/**
 * A release ships the kit beside the API and no mini apps at all: a kit looked for next to a
 * `mini-apps` folder that is not there was looked for at the disk's root, and
 * `GET /rpc/mini-apps/kit` named a folder that was not there.
 */
test('a release finds the kit beside its API, with no mini apps shipped', () => {
  delete process.env.LOCALIX_MINI_APP_KIT_DIR
  const resources = join(root(), 'Resources', 'resources')
  mkdirSync(join(resources, 'mini-app-kit'), { recursive: true })
  writeFileSync(join(resources, 'server.js'), '')
  const kit = miniAppKitDirFrom(pathToFileURL(join(resources, 'server.js')).href)
  expect(kit).toBe(join(resources, 'mini-app-kit'))
})

test('the kit the launcher names wins (development stages one per run)', () => {
  process.env.LOCALIX_MINI_APP_KIT_DIR = '/staged/kit'
  expect(miniAppKitDirFrom(import.meta.url)).toBe('/staged/kit')
})
