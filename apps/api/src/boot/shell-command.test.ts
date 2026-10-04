import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { createShellCommandService } from '../features/shell-command/service'
import {
  hasPersistentShellCommandRuntime,
  removeStaleAppImageLauncher,
  resolveCliEntry,
} from './shell-command'

describe('resolveCliEntry', () => {
  test('prefers an existing desktop-staged shim', () => {
    expect(resolveCliEntry('/Applications/Localix/localix.mjs', '/repo', () => true)).toBe(
      '/Applications/Localix/localix.mjs',
    )
  })

  test('falls back to the source checkout and then the nested desktop layout', () => {
    const cwd = '/repo'
    const source = resolve(cwd, 'packages/cli/bin/localix.mjs')
    const nested = resolve(cwd, '../../packages/cli/bin/localix.mjs')

    expect(resolveCliEntry('/missing', cwd, (path) => path === source)).toBe(source)
    expect(resolveCliEntry(undefined, cwd, (path) => path === nested)).toBe(nested)
  })

  test('reports unavailable when no supported shim exists', () => {
    expect(resolveCliEntry(undefined, '/repo', () => false)).toBeNull()
  })
})

describe('hasPersistentShellCommandRuntime', () => {
  test('rejects Linux AppImage mount paths that disappear after the app exits', () => {
    expect(
      hasPersistentShellCommandRuntime(
        'linux',
        '/tmp/.mount_Localix1/resources/cli/localix.mjs',
        '/tmp/.mount_Localix1/resources/bun',
      ),
    ).toBeFalse()
    expect(
      hasPersistentShellCommandRuntime(
        'linux',
        '/tmp/.mount_Localix2/resources/cli/localix.mjs',
        '/tmp/.mount_Localix2/resources/bun',
      ),
    ).toBeFalse()
  })

  test('accepts durable Linux packages and does not apply the AppImage rule cross-platform', () => {
    expect(
      hasPersistentShellCommandRuntime(
        'linux',
        '/usr/lib/localix/cli/localix.mjs',
        '/usr/lib/localix/bun',
      ),
    ).toBeTrue()
    expect(
      hasPersistentShellCommandRuntime(
        'darwin',
        '/Applications/Localix.app/Contents/Resources/cli/localix.mjs',
        '/Applications/Localix.app/Contents/Resources/bun',
      ),
    ).toBeTrue()
  })
})

describe('removeStaleAppImageLauncher', () => {
  test('removes a legacy AppImage launcher but preserves a durable package launcher', async () => {
    const cleanRoot = await mkdtemp(join(tmpdir(), 'localix-shell-command-'))
    const service = createShellCommandService({
      platform: 'linux',
      home: cleanRoot,
      cliEntry: '/tmp/.mount_Localix1/resources/cli/localix.mjs',
      bunPath: '/tmp/.mount_Localix1/resources/bun',
      pathEnv: '',
      available: false,
    })
    const target = join(cleanRoot, '.local', 'bin', 'localix')

    try {
      await mkdir(join(cleanRoot, '.local', 'bin'), { recursive: true })
      await writeFile(target, '#!/bin/sh\nexec "/tmp/.mount_Localix1/resources/bun" "$@"\n')
      expect(await removeStaleAppImageLauncher(service, 'linux')).toBeTrue()
      expect(await stat(target).catch(() => null)).toBeNull()

      const durable = '#!/bin/sh\nexec "/usr/lib/localix/bun" "$@"\n'
      await writeFile(target, durable)
      expect(await removeStaleAppImageLauncher(service, 'linux')).toBeFalse()
      expect(await readFile(target, 'utf8')).toBe(durable)
    } finally {
      await rm(cleanRoot, { recursive: true, force: true })
    }
  })
})
