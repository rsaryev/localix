import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { Hono } from 'hono'
import { isPathBelow } from '@localixai/path-containment'
import { tempDirPerTest } from '@localixai/testing'

import { createUiStaticHandler, resolveUiAsset } from './ui-static'

const tree = {
  'ui/index.html': '<!doctype html><title>app</title>',
  'ui/assets/app.js': 'console.log(1)',
  'secret.txt': 'dummy-secret',
}
const dir = tempDirPerTest('ui-static', tree)

describe('resolveUiAsset', () => {
  test('a path inside the UI root resolves beneath it', () => {
    const uiRoot = join(dir(), 'ui')
    expect(resolveUiAsset(uiRoot, '/assets/app.js')).toBe(join(uiRoot, 'assets', 'app.js'))
  })

  // Hono decodes `%5C` to `\`, which Windows path functions treat as a separator.
  test('a backslash or NUL is refused on every platform', () => {
    const uiRoot = join(dir(), 'ui')
    for (const path of ['/..\\secret.txt', '/assets\\..\\..\\secret.txt', '/index.html\0.js']) {
      expect(resolveUiAsset(uiRoot, path)).toBeNull()
    }
  })

  test('a dot-dot path never leaves the UI root', () => {
    const uiRoot = join(dir(), 'ui')
    for (const path of ['/../secret.txt', '/assets/../../secret.txt', '/../ui-other/x']) {
      const resolved = resolveUiAsset(uiRoot, path)
      expect(resolved === null || isPathBelow(uiRoot, resolved)).toBe(true)
    }
  })
})

describe('createUiStaticHandler', () => {
  const app = () => new Hono().use('*', createUiStaticHandler(join(dir(), 'ui')))

  test('serves an asset and falls back to index.html for unknown paths', async () => {
    expect(await (await app().request('/assets/app.js')).text()).toBe('console.log(1)')
    expect(await (await app().request('/chat/42')).text()).toContain('<title>app</title>')
  })

  test('an encoded traversal to a sibling file serves index.html, never the file', async () => {
    for (const path of ['/..%5Csecret.txt', '/%2e%2e/secret.txt', '/assets/..%5C..%5Csecret.txt']) {
      const body = await (await app().request(path)).text()
      expect(body).not.toContain('dummy-secret')
      expect(body).toContain('<title>app</title>')
    }
  })
})
