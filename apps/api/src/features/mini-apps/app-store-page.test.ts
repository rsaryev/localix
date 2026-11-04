import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { miniAppScreenshots, readMiniAppReadme, readMiniAppScreenshot } from './app-store-page'

const root = tempDirPerTest('mini-app-store-page-')
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

async function installed(
  manifest: Record<string, unknown>,
  files: Record<string, string | Buffer>,
) {
  const dir = join(root(), 'recall')
  await fs.mkdir(join(dir, 'screenshots'), { recursive: true })
  for (const [path, body] of Object.entries(files)) await fs.writeFile(join(dir, path), body)
  return { name: 'recall', dir, manifest }
}

// A mini app made or installed on this computer showed a bare page in the Store: no README and no
// screenshots, though both sat in its folder — the author never saw the page others would see.
describe('an installed mini app’s own store page', () => {
  test('its screenshots are served from its folder, in the order and with the captions it declares', async () => {
    const app = await installed(
      {
        version: '0.1.0',
        screenshots: [
          { path: './screenshots/today.png', caption: 'Today' },
          { path: './screenshots/stats.png' },
        ],
      },
      { 'screenshots/today.png': PNG, 'screenshots/stats.png': PNG },
    )
    expect(miniAppScreenshots(app)).toEqual([
      { url: '/rpc/mini-apps/recall/screenshot/0?v=0.1.0', caption: 'Today' },
      { url: '/rpc/mini-apps/recall/screenshot/1?v=0.1.0' },
    ])
    const file = await readMiniAppScreenshot(app, 1)
    expect(file.type).toBe('image/png')
    expect(file.bytes.length).toBe(PNG.length)
  })

  test('a screenshot that is missing, not a picture or out of range has nothing to serve', async () => {
    const app = await installed(
      { screenshots: [{ path: './screenshots/gone.png' }, { path: './notes.txt' }] },
      { 'notes.txt': 'not a picture' },
    )
    await expect(readMiniAppScreenshot(app, 0)).rejects.toThrow(/no screenshot/)
    await expect(readMiniAppScreenshot(app, 1)).rejects.toThrow(/no screenshot/)
    await expect(readMiniAppScreenshot(app, 5)).rejects.toThrow(/no screenshot/)
  })

  test('its README is read from its folder, and an app without one has none', async () => {
    expect(await readMiniAppReadme(await installed({}, { 'README.md': '# Recall\n' }))).toBe(
      '# Recall\n',
    )
    const bare = { name: 'bare', dir: join(root(), 'bare'), manifest: {} }
    expect(await readMiniAppReadme(bare)).toBeNull()
  })
})
