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
 * A release ships the kit beside the API and no mini apps at all: a kit found next to a
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

test('the launcher’s kit wins', () => {
  process.env.LOCALIX_MINI_APP_KIT_DIR = '/staged/kit'
  expect(miniAppKitDirFrom(import.meta.url)).toBe('/staged/kit')
})

/**
 * Development runs the API from source and stages the kit beside its staged mini apps; the
 * launcher names only the mini apps folder, so the kit is found next to it.
 */
test('development finds the kit staged beside its mini apps', () => {
  delete process.env.LOCALIX_MINI_APP_KIT_DIR
  const saved = process.env.LOCALIX_BUNDLED_MINI_APPS_DIR
  const stage = join(root(), 'stage')
  mkdirSync(join(stage, 'mini-apps'), { recursive: true })
  mkdirSync(join(stage, 'mini-app-kit'), { recursive: true })
  process.env.LOCALIX_BUNDLED_MINI_APPS_DIR = join(stage, 'mini-apps')
  try {
    expect(miniAppKitDirFrom(import.meta.url)).toBe(join(stage, 'mini-app-kit'))
  } finally {
    if (saved === undefined) delete process.env.LOCALIX_BUNDLED_MINI_APPS_DIR
    else process.env.LOCALIX_BUNDLED_MINI_APPS_DIR = saved
  }
})
