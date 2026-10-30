import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { ConflictError, UnprocessableError } from '../../lib/domain-errors'
import { installLocalPackage } from './local-install'
import { INSTALL_RECORD_FILE, installedBy } from './store-install'
import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'

const tempDir = tempDirPerTest('mini-app-local-install-')

const MANIFEST = {
  name: 'tally',
  version: '0.1.0',
  description: 'Counts things.',
  apiVersion: 1,
  backend: './dist/backend/index-abc.mjs',
}

/** A package as `mini-app build` leaves it: built backend, guide, manifest. */
function builtPackage(manifest: Record<string, unknown> = MANIFEST) {
  const source = tempDir()
  const dir = join(source, 'dist', 'package')
  writeTree(dir, {
    [MINI_APP_MANIFEST_FILE]: JSON.stringify(manifest),
    'guide.md': '# Tally',
    'dist/backend/index-abc.mjs': 'export function register() { return {} }',
  })
  return { source, dir }
}

function host() {
  const installRoot = join(tempDir(), 'mini-apps')
  const enabled: string[] = []
  let changes = 0
  return {
    installRoot,
    enabled,
    changes: () => changes,
    deps: {
      installRoot,
      enable: async (name: string) => void enabled.push(name),
      changed: async () => void changes++,
    },
  }
}

describe('installing a package the person built', () => {
  test('lands as the person’s own app, switched on, and every host is told', async () => {
    const { dir, source } = builtPackage()
    const localix = host()
    const installed = await installLocalPackage({ dir, source }, localix.deps)
    expect(installed).toEqual({ name: 'tally', version: '0.1.0', warnings: [] })
    const target = join(localix.installRoot, 'tally')
    expect(readFileSync(join(target, 'dist/backend/index-abc.mjs'), 'utf8')).toContain('register')
    expect(await installedBy(target)).toBe('person')
    expect(JSON.parse(readFileSync(join(target, INSTALL_RECORD_FILE), 'utf8'))).toMatchObject({
      kind: 'localix-local-install',
      source,
      version: '0.1.0',
    })
    expect(localix.enabled).toEqual(['tally'])
    expect(localix.changes()).toBe(1)
  })

  test('a new build replaces the one installed before', async () => {
    const localix = host()
    const first = builtPackage()
    await installLocalPackage(first, localix.deps)
    const second = builtPackage({ ...MANIFEST, version: '0.2.0' })
    expect((await installLocalPackage(second, localix.deps)).version).toBe('0.2.0')
  })

  test('refuses what Localix would not run, with its reasons', async () => {
    const { dir, source } = builtPackage({ ...MANIFEST, skills: './skills' })
    const error = await installLocalPackage({ dir, source }, host().deps).catch((e) => e)
    expect(error).toBeInstanceOf(UnprocessableError)
    expect(error.message).toContain(`Invalid ${MINI_APP_MANIFEST_FILE}`)
  })

  test('refuses a source folder: Localix installs built code', async () => {
    const { dir, source } = builtPackage({ ...MANIFEST, backend: './backend/index.ts' })
    writeTree(dir, { 'backend/index.ts': 'export {}' })
    const error = await installLocalPackage({ dir, source }, host().deps).catch((e) => e)
    expect(error).toBeInstanceOf(UnprocessableError)
    expect(error.message).toContain('mini-app build')
  })

  test('never replaces a folder it did not install, a marketplace’s app, or the source itself', async () => {
    const localix = host()
    writeTree(join(localix.installRoot, 'tally'), { [MINI_APP_MANIFEST_FILE]: '{}' })
    const handMade = await installLocalPackage(builtPackage(), localix.deps).catch((e) => e)
    expect(handMade).toBeInstanceOf(ConflictError)
    expect(handMade.message).toContain(join(localix.installRoot, 'tally'))

    const other = host()
    writeTree(join(other.installRoot, 'tally'), {
      [INSTALL_RECORD_FILE]: JSON.stringify({
        kind: 'localix-marketplace-install',
        marketplace: 'x',
      }),
    })
    expect(await installLocalPackage(builtPackage(), other.deps).catch((e) => e)).toBeInstanceOf(
      ConflictError,
    )

    // An app authored inside Localix's folder: installing over it would delete its source.
    const third = host()
    const source = join(third.installRoot, 'tally')
    const dir = join(source, 'dist', 'package')
    writeTree(dir, {
      [MINI_APP_MANIFEST_FILE]: JSON.stringify(MANIFEST),
      'dist/backend/index-abc.mjs': 'export {}',
    })
    const inside = await installLocalPackage({ dir, source }, third.deps).catch((e) => e)
    expect(inside).toBeInstanceOf(ConflictError)
    expect(existsSync(join(source, 'dist/package', MINI_APP_MANIFEST_FILE))).toBe(true)
  })
})
