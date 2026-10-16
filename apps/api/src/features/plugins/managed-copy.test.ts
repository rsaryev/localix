import { afterEach, expect, test } from 'bun:test'
import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installManagedCopy, readManagedFingerprint } from './managed-copy'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

test('a managed update retains the installed revision chunks even when staging skipped it', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'managed-ui-chunks-'))
  roots.push(root)
  const source = join(root, 'source')
  const installed = join(root, 'installed')
  const sourceUi = join(source, 'dist', 'ui')
  const installedUi = join(installed, 'dist', 'ui')
  const build = async (revision: string) => {
    await fs.rm(sourceUi, { recursive: true, force: true })
    await fs.mkdir(join(sourceUi, 'chunks'), { recursive: true })
    await fs.writeFile(
      join(sourceUi, 'chunks', `${revision}.js`),
      `export const panel = '${revision}'`,
    )
    await fs.writeFile(
      join(sourceUi, '.current-files.json'),
      JSON.stringify([`chunks/${revision}.js`]),
    )
    await fs.writeFile(join(sourceUi, 'manifest.json'), JSON.stringify({ revision }))
  }

  await build('v1')
  await installManagedCopy(source, installed, 'v1')
  // Two source rebuilds can finish before the API installs either of them.
  await build('v2')
  await build('v3')
  await installManagedCopy(source, installed, 'v3')
  expect(await fs.readFile(join(installedUi, 'chunks', 'v1.js'), 'utf8')).toContain("'v1'")
  expect(await fs.readFile(join(installedUi, 'manifest.json'), 'utf8')).toBe('{"revision":"v3"}')
  expect(await fs.readFile(join(installedUi, '.current-files.json'), 'utf8')).toBe(
    '["chunks/v3.js"]',
  )
  expect(await readManagedFingerprint(installed)).toBe('v3')

  // Updating backend/docs changes the managed fingerprint, but not the UI revision. An open
  // v1 tab must retain its lazy chunks through repeated identical UI installations.
  for (const fingerprint of ['v3-backend', 'v3-docs']) {
    await build('v3')
    await installManagedCopy(source, installed, fingerprint)
    expect(existsSync(join(installedUi, 'chunks', 'v1.js'))).toBe(true)
    expect(await readManagedFingerprint(installed)).toBe(fingerprint)
  }

  await build('v4')
  await installManagedCopy(source, installed, 'v4')
  expect(existsSync(join(installedUi, 'chunks', 'v1.js'))).toBe(false)
  expect(existsSync(join(installedUi, 'chunks', 'v3.js'))).toBe(true)

  await fs.rm(sourceUi, { recursive: true })
  await installManagedCopy(source, installed, 'no-ui')
  expect(existsSync(installedUi)).toBe(false)
})
