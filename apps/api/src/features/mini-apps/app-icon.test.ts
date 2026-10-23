import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { miniAppIconUrl, readMiniAppIcon } from './app-icon'

const root = tempDirPerTest('mini-app-icon-')
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect/></svg>'

async function installed(manifest: { icon?: string; version?: string }, icon?: string) {
  const dir = join(root(), 'chess')
  await fs.mkdir(dir, { recursive: true })
  if (icon !== undefined) await fs.writeFile(join(dir, 'icon.svg'), icon)
  return { name: 'chess', dir, manifest }
}

describe('an installed mini app’s own icon', () => {
  test('is served from its folder by the path its manifest names', async () => {
    const app = await installed({ icon: './icon.svg', version: '1.2.0' }, ICON)
    expect(miniAppIconUrl(app)).toBe('/rpc/mini-apps/chess/icon?v=1.2.0')
    const file = await readMiniAppIcon(app)
    expect(file.type).toBe('image/svg+xml')
    expect(new TextDecoder().decode(file.bytes)).toBe(ICON)
  })

  test('an app with no icon, or one that is not a picture, has none to serve', async () => {
    const none = await installed({})
    expect(miniAppIconUrl(none)).toBeUndefined()
    await expect(readMiniAppIcon(none)).rejects.toThrow(/no icon/)
    const scripted = await installed(
      { icon: './icon.svg' },
      '<svg viewBox="0 0 1 1"><script/></svg>',
    )
    await expect(readMiniAppIcon(scripted)).rejects.toThrow(/no icon/)
    const outside = await installed({ icon: '../icon.svg' }, ICON)
    await expect(readMiniAppIcon(outside)).rejects.toThrow(/no icon/)
  })
})
