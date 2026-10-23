import { expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { tempDirPerTest } from '@localixai/testing'

import { assertGunzipWithin } from './marketplace-gzip-limit'

const tempDir = tempDirPerTest('gzip-limit-')

test('a gzip that unpacks past the limit is refused before extraction', async () => {
  const file = join(tempDir(), 'bomb.tgz')
  await fs.writeFile(file, gzipSync(Buffer.alloc(1024 * 1024)))
  await expect(assertGunzipWithin(file, 'npm tarball', 64 * 1024)).rejects.toMatchObject({
    code: 'plugin_npm_tarball_too_large',
  })
  await assertGunzipWithin(file, 'npm tarball', 2 * 1024 * 1024)
})

test('a file that is not gzip fails as an extraction error', async () => {
  const file = join(tempDir(), 'plain.tgz')
  await fs.writeFile(file, 'not gzip')
  await expect(assertGunzipWithin(file, 'npm tarball')).rejects.toMatchObject({
    code: 'plugin_npm_extract_failed',
  })
})
