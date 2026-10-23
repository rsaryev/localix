import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { readAppFile } from './app-files'

const root = tempDirPerTest('mini-app-files-')

describe('a file of a mini app, read by its manifest path', () => {
  test('is read from inside the folder only, never through a link that leaves it', async () => {
    const app = join(root(), 'notes')
    await fs.mkdir(join(app, 'screenshots'), { recursive: true })
    await fs.writeFile(join(app, 'icon.svg'), '<svg/>')
    await fs.writeFile(join(root(), 'secret.txt'), 'secret')
    await fs.symlink(join(root(), 'secret.txt'), join(app, 'screenshots', 'leak.png'))

    expect(new TextDecoder().decode((await readAppFile(app, './icon.svg'))!)).toBe('<svg/>')
    expect(await readAppFile(app, '../secret.txt')).toBeNull()
    expect(await readAppFile(app, 'screenshots/leak.png')).toBeNull()
    expect(await readAppFile(app, 'screenshots')).toBeNull()
    expect(await readAppFile(app, 'missing.png')).toBeNull()
  })

  test('one larger than the cap is not read', async () => {
    const app = join(root(), 'big')
    await fs.mkdir(app, { recursive: true })
    await fs.writeFile(join(app, 'shot.png'), new Uint8Array(2048))
    expect(await readAppFile(app, 'shot.png', { maxBytes: 1024 })).toBeNull()
    expect((await readAppFile(app, 'shot.png', { maxBytes: 4096 }))?.byteLength).toBe(2048)
  })
})
