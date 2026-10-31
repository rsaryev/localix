/** The static preview server never serves dotfiles or dot-directories, except /.well-known/. */
import { afterEach, expect, test } from 'bun:test'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { disposeStaticServers, ensureStaticServer } from './preview-static'

const dir = tempDirPerTest('localix-preview-dotfiles')

afterEach(() => disposeStaticServers())

test('answers 404 for dotfiles and dot-directories but serves .well-known', async () => {
  writeTree(dir(), {
    'index.html': '<p>hi</p>',
    '.env': 'dummy-env',
    '.git/config': 'dummy-git',
    'sub/.ssh/id': 'dummy-ssh',
    'sub/.hidden.txt': 'dummy-hidden',
    '.well-known/assetlinks.json': '{"ok":1}',
    'sub/ok.txt': 'dummy-ok',
  })
  symlinkSync('.git', join(dir(), 'gitlink'))
  const port = ensureStaticServer(dir())
  const get = (p: string) => fetch(`http://127.0.0.1:${port}/${p}`)

  for (const hidden of [
    '.env',
    '.git/config',
    'sub/.ssh/id',
    'sub/.hidden.txt',
    '%2eenv',
    '.git%2Fconfig',
    'gitlink/config',
  ]) {
    const res = await get(hidden)
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('dummy-')
  }
  expect(await (await get('.well-known/assetlinks.json')).text()).toBe('{"ok":1}')
  expect(await (await get('sub/ok.txt')).text()).toBe('dummy-ok')
})
