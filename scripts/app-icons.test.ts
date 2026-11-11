import { describe, expect, test } from 'bun:test'
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import sharp from 'sharp'
import {
  ICONS_DIR,
  checkAppIcons,
  icnsEntries,
  icoEntries,
  pngSize,
  readBird,
} from './app-icons.mjs'

const tempDir = tempDirPerTest('app-icons-')
const read = (name: string) => readFileSync(join(ICONS_DIR, name))
const conf = JSON.parse(readFileSync(join(ICONS_DIR, '..', 'tauri.conf.json'), 'utf8')) as {
  bundle: { icon: string[] }
}

/** The box of pixels at least half opaque, in a PNG. */
async function opaqueBox(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let [left, top, right, bottom] = [info.width, info.height, -1, -1]
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if ((data[(y * info.width + x) * 4 + 3] ?? 0) < 128) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 }
}

describe('the committed icon set', () => {
  test('is what the generator made from the current source, untouched since', () => {
    expect(checkAppIcons()).toBeUndefined()
  })

  test('is flagged stale when the artwork changes and the set is not regenerated', () => {
    const bird = readBird().replace('rgb(255,255,255)', 'rgb(254,255,255)')
    expect(checkAppIcons({ bird })).toContain('stale')
  })

  test('is flagged when a generated file is edited by hand, removed or added', () => {
    const dir = tempDir()
    cpSync(ICONS_DIR, dir, { recursive: true })
    writeFileSync(join(dir, '32x32.png'), Buffer.concat([read('32x32.png'), Buffer.from([0])]))
    expect(checkAppIcons({ dir })).toContain('32x32.png')
    cpSync(join(ICONS_DIR, '32x32.png'), join(dir, '32x32.png'))
    writeFileSync(join(dir, 'stray.png'), read('32x32.png'))
    expect(checkAppIcons({ dir })).toContain('stray.png')
  })
})

describe('what each platform is given', () => {
  test('every file the bundle names exists, the first PNG the largest', () => {
    // Linux takes its window and taskbar icon from the FIRST png in `bundle.icon`
    // (tauri-codegen `find_icon`), so a 32 px icon first is a blurry window icon there.
    const pngs = conf.bundle.icon.filter((file) => file.endsWith('.png'))
    const widths = pngs.map((file) => pngSize(read(file.replace('icons/', ''))).width)
    expect(widths[0]).toBe(Math.max(...widths))
    expect(widths[0]).toBeGreaterThanOrEqual(512)
    for (const file of conf.bundle.icon)
      expect(read(file.replace('icons/', '')).length).toBeGreaterThan(0)
  })

  test('the Mac icon has every representation up to 1024, each drawn at its own size', () => {
    const entries = icnsEntries(read('icon.icns'))
    const sizes = Object.fromEntries(entries.map((entry) => [entry.type, entry.width]))
    expect(sizes).toMatchObject({
      ic04: 16,
      ic11: 32,
      ic05: 32,
      ic12: 64,
      ic07: 128,
      ic13: 256,
      ic08: 256,
      ic14: 512,
      ic09: 512,
      ic10: 1024,
    })
  })

  test("the Mac icon's plate sits on Apple's macOS grid: 824 of 1024, 100 from each edge", async () => {
    const big = icnsEntries(read('icon.icns')).find((entry) => entry.type === 'ic10')
    expect(big).toBeDefined()
    const box = await opaqueBox(big?.png ?? Buffer.alloc(0))
    for (const edge of [box.left, box.top]) expect(Math.abs(edge - 100)).toBeLessThanOrEqual(1)
    for (const side of [box.width, box.height]) expect(Math.abs(side - 824)).toBeLessThanOrEqual(1)
  })

  test('Windows gets every size its shell asks for', () => {
    expect(icoEntries(read('icon.ico')).map((entry) => entry.width)).toEqual([
      16, 24, 32, 48, 64, 256,
    ])
  })

  test('the menu-bar glyph is a template image: black, shaped by alpha alone, 18 pt at 2x', async () => {
    const png = read('tray-template.png')
    expect(pngSize(png)).toEqual({ width: 36, height: 36 })
    const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let inked = 0
    for (let at = 0; at < data.length; at += 4) {
      if ((data[at + 3] ?? 0) === 0) continue
      inked++
      expect([data[at], data[at + 1], data[at + 2]]).toEqual([0, 0, 0])
    }
    expect(inked).toBeGreaterThan(36 * 36 * 0.2)
  })
})
