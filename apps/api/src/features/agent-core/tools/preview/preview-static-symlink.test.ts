/**
 * The static preview server confines requests to its root by REAL path: a symlink inside the root
 * that points outside it (a cloned repository can commit one) must not serve the target's bytes.
 */
import { afterEach, expect, test } from 'bun:test'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { disposeStaticServers, ensureStaticServer } from './preview-static'

const dir = tempDirPerTest('localix-preview-symlink')

afterEach(() => disposeStaticServers())

test('refuses a file reached through a symlink that leaves the served root', async () => {
  writeTree(dir(), {
    'outside/secret.txt': 'dummy-secret',
    'root/index.html': '<p>hi</p>',
    'root/inside.txt': 'dummy-inside',
    'root/sub/a.txt': 'dummy-a',
  })
  symlinkSync('../outside', join(dir(), 'root', 'out'))
  symlinkSync('../outside/secret.txt', join(dir(), 'root', 'leak.txt'))
  symlinkSync('sub', join(dir(), 'root', 'alias'))
  const port = ensureStaticServer(join(dir(), 'root'))
  const get = (p: string) => fetch(`http://127.0.0.1:${port}/${p}`)

  for (const escape of ['out/secret.txt', 'leak.txt']) {
    const res = await get(escape)
    expect(res.status).toBe(403)
    expect(await res.text()).not.toContain('dummy-secret')
  }
  // A symlink that stays inside the root, and plain files, still serve.
  expect(await (await get('alias/a.txt')).text()).toBe('dummy-a')
  expect(await (await get('inside.txt')).text()).toBe('dummy-inside')
  expect((await get('missing.txt')).status).toBe(404)
})

test('serves a root that is itself reached through a symlink', async () => {
  writeTree(dir(), { 'real/inside.txt': 'dummy-inside' })
  symlinkSync('real', join(dir(), 'link'))
  const port = ensureStaticServer(join(dir(), 'link'))
  const res = await fetch(`http://127.0.0.1:${port}/inside.txt`)
  expect(res.status).toBe(200)
  expect(await res.text()).toBe('dummy-inside')
})
