import { afterEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildShotManifest, pngDimensions } from './build-shots.mjs'

const tempRoots = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })))
})

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12)
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localix-shots-'))
  tempRoots.push(root)
  const shotsDir = path.join(root, 'shots')
  const outFile = path.join(root, 'generated', 'shots.ts')
  await fs.mkdir(shotsDir)
  return { shotsDir, outFile }
}

describe('product screenshot manifest', () => {
  test('reads PNG dimensions from the IHDR header', () => {
    expect(pngDimensions(pngHeader(1600, 1000))).toEqual({ width: 1600, height: 1000 })
    expect(() => pngDimensions(Buffer.from('not png'))).toThrow('not a PNG file')
  })

  test('selects the newest dated capture for each semantic key', async () => {
    const { shotsDir, outFile } = await fixture()
    await fs.mkdir(path.join(shotsDir, 'reader'))
    await fs.mkdir(path.join(shotsDir, 'workspace'))
    await fs.writeFile(
      path.join(shotsDir, 'reader', 'gallery--2026-08-05.png'),
      pngHeader(1600, 1000),
    )
    await fs.writeFile(
      path.join(shotsDir, 'reader', 'gallery--2026-08-06.png'),
      pngHeader(1600, 1000),
    )
    await fs.writeFile(
      path.join(shotsDir, 'workspace', 'editor-grid--2026-07-30.png'),
      pngHeader(1600, 1000),
    )

    expect(await buildShotManifest({ shotsDir, outFile })).toEqual([
      { key: 'reader/gallery', capturedAt: '2026-08-06' },
      { key: 'workspace/editor-grid', capturedAt: '2026-07-30' },
    ])

    const generated = await fs.readFile(outFile, 'utf8')
    expect(generated).toContain('"reader/gallery": { src: shot0, capturedAt: "2026-08-06" }')
    expect(generated).toContain('gallery--2026-08-06.png')
    expect(generated).not.toContain('gallery--2026-08-05.png')
    expect(generated).toContain(
      '"docs/assets/screenshots/reader/gallery--2026-08-06.png": { src: shot0',
    )
  })

  test('indexes a placeholder slot apart from dated captures and drops it once captured', async () => {
    const { shotsDir, outFile } = await fixture()
    await fs.mkdir(path.join(shotsDir, 'task-board'))
    await fs.mkdir(path.join(shotsDir, 'reader'))
    await fs.writeFile(
      path.join(shotsDir, 'task-board', 'board--placeholder.png'),
      pngHeader(1600, 1000),
    )
    await fs.writeFile(
      path.join(shotsDir, 'reader', 'gallery--placeholder.png'),
      pngHeader(1600, 1000),
    )
    await fs.writeFile(
      path.join(shotsDir, 'reader', 'gallery--2026-08-06.png'),
      pngHeader(1600, 1000),
    )

    // A placeholder is never reported as a dated capture, nor published to the docs manifest.
    const publicDir = path.join(path.dirname(shotsDir), 'public-shots')
    expect(await buildShotManifest({ shotsDir, outFile, publicDir })).toEqual([
      { key: 'reader/gallery', capturedAt: '2026-08-06' },
    ])
    const generated = await fs.readFile(outFile, 'utf8')
    expect(generated).not.toContain('placeholder')
    expect(generated).not.toContain('task-board/board')
  })

  test('the homepage manifest points at plain public paths and flags placeholders', async () => {
    const { shotsDir, outFile } = await fixture()
    const publicDir = path.join(path.dirname(shotsDir), 'public-shots')
    await fs.mkdir(path.join(shotsDir, 'task-board'))
    await fs.mkdir(path.join(shotsDir, 'workspace'))
    await fs.writeFile(
      path.join(shotsDir, 'task-board', 'board--placeholder.png'),
      pngHeader(1600, 1000),
    )
    await fs.writeFile(
      path.join(shotsDir, 'workspace', 'hero--placeholder.png'),
      pngHeader(1600, 1000),
    )
    await fs.writeFile(
      path.join(shotsDir, 'workspace', 'hero--2026-10-05.png'),
      pngHeader(1600, 1000),
    )

    await buildShotManifest({ shotsDir, outFile, publicDir })

    const home = await fs.readFile(path.join(path.dirname(outFile), 'home-shots.ts'), 'utf8')
    expect(home).toContain(
      '"task-board/board": { src: "/shots/task-board/board--placeholder.png", placeholder: true }',
    )
    // The dated capture wins over the placeholder of the same key.
    expect(home).toContain(
      '"workspace/hero": { src: "/shots/workspace/hero--2026-10-05.png", placeholder: false }',
    )
    expect(home).not.toContain('hero--placeholder')
    expect(await fs.readdir(path.join(publicDir, 'workspace'))).toEqual(['hero--2026-10-05.png'])
  })

  test('keeps the approved editor capture on the homepage when newer evidence exists', async () => {
    const { shotsDir, outFile } = await fixture()
    const publicDir = path.join(path.dirname(shotsDir), 'public-shots')
    await fs.mkdir(path.join(shotsDir, 'workspace'))
    for (const date of ['2026-10-07', '2026-10-09']) {
      await fs.writeFile(
        path.join(shotsDir, 'workspace', `hero--${date}.png`),
        pngHeader(4800, 3000),
      )
    }

    await buildShotManifest({ shotsDir, outFile, publicDir })

    const home = await fs.readFile(path.join(path.dirname(outFile), 'home-shots.ts'), 'utf8')
    expect(home).toContain('/shots/workspace/hero--2026-10-07.png')
    expect(home).not.toContain('hero--2026-10-09.png')
    expect(await fs.readFile(outFile, 'utf8')).toContain('/shots/workspace/hero--2026-10-09.png')
    expect((await fs.readdir(path.join(publicDir, 'workspace'))).sort()).toEqual([
      'hero--2026-10-07.png',
      'hero--2026-10-09.png',
    ])
  })

  test('rejects a placeholder with the wrong dimensions', async () => {
    const { shotsDir, outFile } = await fixture()
    await fs.mkdir(path.join(shotsDir, 'task-board'))
    await fs.writeFile(
      path.join(shotsDir, 'task-board', 'board--placeholder.png'),
      pngHeader(800, 500),
    )

    expect(buildShotManifest({ shotsDir, outFile })).rejects.toThrow('must be 1600×1000')
  })

  test('rejects a screenshot without the semantic dated path', async () => {
    const { shotsDir, outFile } = await fixture()
    await fs.writeFile(path.join(shotsDir, 'legacy.png'), pngHeader(1600, 1000))

    expect(buildShotManifest({ shotsDir, outFile })).rejects.toThrow(
      'Screenshot path must be <feature>/<surface>--YYYY-MM-DD.png',
    )
  })

  test('rejects an impossible capture date', async () => {
    const { shotsDir, outFile } = await fixture()
    await fs.mkdir(path.join(shotsDir, 'reader'))
    await fs.writeFile(
      path.join(shotsDir, 'reader', 'gallery--2026-02-31.png'),
      pngHeader(1600, 1000),
    )

    expect(buildShotManifest({ shotsDir, outFile })).rejects.toThrow(
      'must end in a valid --YYYY-MM-DD date',
    )
  })

  test('rejects a screenshot with the wrong dimensions', async () => {
    const { shotsDir, outFile } = await fixture()
    await fs.mkdir(path.join(shotsDir, 'reader'))
    await fs.writeFile(
      path.join(shotsDir, 'reader', 'gallery--2026-08-06.png'),
      pngHeader(1200, 800),
    )

    expect(buildShotManifest({ shotsDir, outFile })).rejects.toThrow('must be 1600×1000')
  })

  test('publishes native Retina captures without changing their pixels', async () => {
    for (const density of [2, 3]) {
      const { shotsDir, outFile } = await fixture()
      const publicDir = path.join(path.dirname(shotsDir), 'public-shots')
      await fs.mkdir(path.join(shotsDir, 'workspace'))
      const pixels = pngHeader(1600 * density, 1000 * density)
      await fs.writeFile(path.join(shotsDir, 'workspace', 'hero--2026-10-07.png'), pixels)

      await buildShotManifest({ shotsDir, outFile, publicDir })

      expect(await fs.readFile(path.join(publicDir, 'workspace', 'hero--2026-10-07.png'))).toEqual(
        pixels,
      )
    }
  })

  test('rejects mismatched, fractional, and excessive capture density', async () => {
    for (const [width, height] of [
      [4800, 1000],
      [2400, 1500],
      [6400, 4000],
    ]) {
      const { shotsDir, outFile } = await fixture()
      await fs.mkdir(path.join(shotsDir, 'workspace'))
      await fs.writeFile(
        path.join(shotsDir, 'workspace', 'hero--2026-10-07.png'),
        pngHeader(width, height),
      )

      await expect(buildShotManifest({ shotsDir, outFile })).rejects.toThrow('must be 1600×1000')
    }
  })
})

test('keeps historical comparisons out of the current public capture manifest', async () => {
  const { shotsDir, outFile } = await fixture()
  await fs.mkdir(path.join(shotsDir, 'workspace'))
  await fs.writeFile(
    path.join(shotsDir, 'workspace/workbench-before--2026-09-30.png'),
    pngHeader(1600, 1000),
  )
  expect(await buildShotManifest({ shotsDir, outFile })).toEqual([])
  expect(await fs.readFile(outFile, 'utf8')).not.toContain('workbench-before')
})

test('publishes documentation captures at the same URL for Bun prerender and Vite hydration', async () => {
  const { shotsDir, outFile } = await fixture()
  await fs.mkdir(path.join(shotsDir, 'agents'))
  const bytes = pngHeader(4800, 3000)
  await fs.writeFile(path.join(shotsDir, 'agents/context-and-limits--2026-10-08.png'), bytes)
  const publicDir = path.join(path.dirname(shotsDir), 'public-shots')
  await buildShotManifest({ shotsDir, outFile, publicDir })
  const manifest = await fs.readFile(outFile, 'utf8')
  expect(manifest).toContain('src: "/shots/agents/context-and-limits--2026-10-08.png"')
  expect(manifest).not.toContain('import shot')
  expect(
    await fs.readFile(path.join(publicDir, 'agents/context-and-limits--2026-10-08.png')),
  ).toEqual(bytes)
})
