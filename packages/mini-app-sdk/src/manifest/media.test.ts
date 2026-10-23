import { describe, expect, test } from 'bun:test'
import {
  checkMiniAppMedia,
  isAppRelativePath,
  MINI_APP_ICON_MAX_BYTES,
  MINI_APP_SCREENSHOT_MAX_BYTES,
  readImageInfo,
} from './media'

/** A PNG whose header says `width`×`height`; the pixels do not matter to the check. */
function png(width: number, height: number, pad = 0): Uint8Array {
  const bytes = new Uint8Array(33 + pad)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
  ])
}

const svg = (attrs: string, body = '<rect width="1" height="1"/>') =>
  new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`)

const files = (map: Record<string, Uint8Array>) => async (path: string) =>
  map[path.replace(/^\.\//, '')] ?? null

describe('reading an image the way the store shows it', () => {
  test('a PNG, a JPEG, an SVG and an ICO say their size; bytes of another kind say nothing', () => {
    expect(readImageInfo(png(1024, 1024), 'png')).toEqual({
      type: 'image/png',
      width: 1024,
      height: 1024,
    })
    expect(readImageInfo(jpeg(1600, 1000), 'jpg')).toMatchObject({ width: 1600, height: 1000 })
    expect(readImageInfo(svg('viewBox="0 0 1024 1024"'), 'svg')).toMatchObject({
      type: 'image/svg+xml',
      width: 1024,
      height: 1024,
    })
    const ico = new Uint8Array([0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(readImageInfo(ico, 'ico')).toMatchObject({ width: 256, height: 256 })
    expect(readImageInfo(png(10, 10), 'jpg')).toBeNull()
    expect(readImageInfo(new TextEncoder().encode('hello'), 'svg')).toBeNull()
  })
})

describe('a path inside the app', () => {
  test('is relative and never climbs out', () => {
    expect(isAppRelativePath('./icon.svg')).toBe(true)
    expect(isAppRelativePath('screenshots/board.png')).toBe(true)
    expect(isAppRelativePath('../icon.svg')).toBe(false)
    expect(isAppRelativePath('/etc/icon.svg')).toBe(false)
    expect(isAppRelativePath('a/../../b.png')).toBe(false)
    expect(isAppRelativePath('C:\\icon.svg')).toBe(false)
  })
})

describe('the media a publishable mini app declares', () => {
  const icon = svg('viewBox="0 0 1024 1024"')

  test('a square icon and real screenshots pass', async () => {
    const problems = await checkMiniAppMedia(
      { icon: './icon.svg', screenshots: [{ path: './screenshots/board.png' }] },
      files({ 'icon.svg': icon, 'screenshots/board.png': png(4800, 3000) }),
      { requireIcon: true },
    )
    expect(problems).toEqual([])
  })

  test('no icon, or one that is not there, is refused with what to do', async () => {
    expect(await checkMiniAppMedia({}, files({}), { requireIcon: true })).toEqual([
      'mini-app.json declares no "icon"; a published mini app needs one (an .svg, or a square .png of at least 512×512)',
    ])
    expect(await checkMiniAppMedia({ icon: './icon.svg' }, files({}))).toEqual([
      'The icon ./icon.svg is not in the mini app folder',
    ])
  })

  test('an icon of the wrong kind, size or shape is refused', async () => {
    const check = (path: string, bytes: Uint8Array) =>
      checkMiniAppMedia({ icon: path }, files({ [path]: bytes }))
    expect(await check('icon.gif', png(512, 512))).toEqual([
      'The icon icon.gif is a .gif; use .svg, .png, .ico or .webp',
    ])
    expect(await check('icon.png', png(256, 256))).toEqual([
      'The icon icon.png is 256×256; a .png icon needs at least 512×512',
    ])
    expect(await check('icon.png', png(1024, 512))).toEqual([
      'The icon icon.png is 1024×512; an icon must be square',
    ])
    expect(await check('icon.svg', png(512, 512))).toEqual(['The icon icon.svg is not a .svg file'])
    expect(await check('icon.png', png(512, 512, MINI_APP_ICON_MAX_BYTES))).toEqual([
      'The icon icon.png is 256.0 KB; an icon may be at most 256 KB',
    ])
    expect(
      await check('icon.svg', svg('viewBox="0 0 10 10"', '<script>alert(1)</script>')),
    ).toEqual(['The icon icon.svg holds a script; an icon is a picture only'])
  })

  test('a screenshot that is missing, of another kind or too large is refused', async () => {
    const problems = await checkMiniAppMedia(
      {
        icon: 'icon.svg',
        screenshots: [{ path: 'a.png' }, { path: 'b.gif' }, { path: 'c.png' }, { path: 'd.jpg' }],
      },
      files({
        'icon.svg': icon,
        'b.gif': png(10, 10),
        'c.png': png(10, 10, MINI_APP_SCREENSHOT_MAX_BYTES),
        'd.jpg': png(10, 10),
      }),
    )
    expect(problems).toEqual([
      'The screenshot a.png is not in the mini app folder',
      'The screenshot b.gif is a .gif; use .png, .jpg, .jpeg or .webp',
      'The screenshot c.png is 5.0 MB; a screenshot may be at most 5 MB',
      'The screenshot d.jpg is not a .jpg file',
    ])
  })

  test('a homepage is an https address', async () => {
    const check = (homepage: string) =>
      checkMiniAppMedia({ icon: 'icon.svg', homepage }, files({ 'icon.svg': icon }))
    expect(await check('https://example.com/notes')).toEqual([])
    expect(await check('http://example.com')).toEqual([
      'The homepage http://example.com is not an https:// address',
    ])
  })
})
