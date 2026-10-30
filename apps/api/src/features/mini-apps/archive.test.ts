import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { packMiniAppFiles, unpackMiniAppArchive } from './archive'
import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'

const root = tempDirPerTest('mini-app-archive-')

const manifest = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ name: 'atlas', version: '1.0.0', ...over })

describe('a mini app archive', () => {
  test('unpacks into the folder it is given, every file where the archive put it', async () => {
    const bytes = await packMiniAppFiles({
      [MINI_APP_MANIFEST_FILE]: manifest(),
      'backend/index.mjs': 'export const register = () => {}',
    })
    const dest = join(root(), 'out')
    await unpackMiniAppArchive(bytes, dest, { name: 'atlas', version: '1.0.0' })
    expect(await fs.readFile(join(dest, 'backend', 'index.mjs'), 'utf8')).toContain('register')
  })

  test('a path that climbs out of the folder is refused and nothing is written', async () => {
    const bytes = await packMiniAppFiles({
      [MINI_APP_MANIFEST_FILE]: manifest(),
      '../escape.txt': 'x',
    })
    const dest = join(root(), 'out')
    await expect(
      unpackMiniAppArchive(bytes, dest, { name: 'atlas', version: '1.0.0' }),
    ).rejects.toThrow(/outside/)
    expect(await fs.readdir(root())).not.toContain('escape.txt')
  })

  test('the manifest must name the app and version the marketplace promised', async () => {
    const bytes = await packMiniAppFiles({ [MINI_APP_MANIFEST_FILE]: manifest({ name: 'other' }) })
    await expect(
      unpackMiniAppArchive(bytes, join(root(), 'a'), { name: 'atlas', version: '1.0.0' }),
    ).rejects.toThrow(/"other"/)
    const old = await packMiniAppFiles({ [MINI_APP_MANIFEST_FILE]: manifest({ version: '0.9.0' }) })
    await expect(
      unpackMiniAppArchive(old, join(root(), 'b'), { name: 'atlas', version: '1.0.0' }),
    ).rejects.toThrow(/0\.9\.0/)
  })

  test('one larger than the limit is refused', async () => {
    const bytes = await packMiniAppFiles({
      [MINI_APP_MANIFEST_FILE]: manifest(),
      'big.bin': 'x'.repeat(64),
    })
    await expect(
      unpackMiniAppArchive(
        bytes,
        join(root(), 'c'),
        { name: 'atlas', version: '1.0.0' },
        {
          maxBytes: 32,
        },
      ),
    ).rejects.toThrow(/larger/)
  })
})
