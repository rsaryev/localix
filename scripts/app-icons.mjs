// Generate the desktop app's icon set from its one vector source, the bird in `assets/logo.svg`.
//
//   bun scripts/app-icons.mjs --write   redraw every icon (macOS: needs `iconutil`; uses the Tauri CLI)
//   bun scripts/app-icons.mjs --check   fail when the committed set is stale or was edited by hand
//
// The bird is the artwork; the plate behind it and where the bird sits on it are the constants
// below. Every raster is drawn from the vector at its own size by `tauri icon` (resvg), and the Mac
// `.icns` is packed by Apple's `iconutil` from those drawings, so nothing is ever scaled up from a
// smaller raster. The Mac icon is drawn on Apple's macOS grid; Windows and Linux keep the artwork's
// own, larger plate. Why, and what macOS 26 does with an `.icns`, is in
// apps/desktop-tauri/README.md ("The app icon").
//
// `generated.json` beside the icons records a digest of the composed sources and of each file.
// `--check` (run by `check:generated`) needs no renderer: it recomposes the sources, compares
// digests and the file list, and so works on any platform.
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { repoRoot } from './lib/paths.mjs'
import { run } from './lib/run.mjs'

const root = repoRoot()
export const ICONS_DIR = join(root, 'apps', 'desktop-tauri', 'src-tauri', 'icons')
const BIRD_FILE = join(root, 'assets', 'logo.svg')
const MANIFEST = 'generated.json'
const TAURI = join(root, 'node_modules', '.bin', 'tauri')

/**
 * Apple's macOS app icon grid on its 1024 canvas: an 824 rounded rectangle, 100 from each edge,
 * corner radius 185.4 (Apple Design Resources, macOS app icon template). macOS 26 masks an `.icns`
 * drawn on this grid to its own shape; macOS 13 to 15 show it as drawn.
 */
const MAC_PLATE = { inset: 100, size: 824, radius: 185.4 }
/** The artwork's own plate (as in LLX Desk's icon.svg), for Windows and Linux, which mask nothing. */
const ARTWORK_PLATE = { inset: 64, size: 896, radius: 200 }
/** Where the bird's 2048 box sits on a plate, as fractions of the plate: the artwork's optical centre. */
const BIRD_ON_PLATE = { dx: 20 / 896, dy: -4 / 896, size: 892 / 896 }
/** The bird's ink, in its own 2048 units, squared and padded: what the menu-bar glyph shows. */
const GLYPH_VIEW = '193.5 218 1600 1600'
/** The Windows taskbar's attention dot (`set_badge`). */
const BADGE = { colour: '#e5484d', radius: 13 }

/** Mac representations: pixel size of each, and the iconset names that use it. */
const MAC_SIZES = [16, 32, 64, 128, 256, 512, 1024]
const ICONSET = [16, 32, 128, 256, 512].flatMap((size) => [
  [`icon_${size}x${size}.png`, size],
  [`icon_${size}x${size}@2x.png`, size * 2],
])
/** What `tauri icon` draws that the bundle, the window and the tray use. */
const DESKTOP_FILES = [
  '32x32.png',
  '64x64.png',
  '128x128.png',
  '128x128@2x.png',
  'icon.png',
  'icon.ico',
]

export const readBird = () => readFileSync(BIRD_FILE, 'utf8')

/** The bird's drawing without its own `<svg>` element, to nest in another. */
function birdBody(bird) {
  const body = /<svg[^>]*>([\s\S]*)<\/svg>/u.exec(bird)?.[1]
  if (!body) throw new Error(`${BIRD_FILE} has no <svg> element`)
  return body
}

function plateIcon(bird, plate) {
  const k = plate.size
  const at = (value) => Number(value.toFixed(2))
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">',
    '<defs><linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="#131316"/><stop offset="1" stop-color="#0a0a0b"/>',
    '</linearGradient></defs>',
    `<rect x="${plate.inset}" y="${plate.inset}" width="${k}" height="${k}" rx="${plate.radius}" fill="url(#plate)"/>`,
    `<svg x="${at(plate.inset + BIRD_ON_PLATE.dx * k)}" y="${at(plate.inset + BIRD_ON_PLATE.dy * k)}"`,
    ` width="${at(BIRD_ON_PLATE.size * k)}" height="${at(BIRD_ON_PLATE.size * k)}" viewBox="0 0 2048 2048">`,
    birdBody(bird),
    '</svg></svg>',
  ].join('')
}

/** The bird alone in black: a template image takes only its alpha. */
function glyph(bird) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${GLYPH_VIEW}" width="1024" height="1024">`,
    '<filter id="black" filterUnits="userSpaceOnUse" x="0" y="0" width="2048" height="2048">',
    '<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"/></filter>',
    `<g filter="url(#black)">${birdBody(bird)}</g></svg>`,
  ].join('')
}

const badge = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="1024" height="1024"><circle cx="16" cy="16" r="${BADGE.radius}" fill="${BADGE.colour}"/></svg>`

/** Every vector the set is drawn from, keyed by role. */
export function composeSources(bird = readBird()) {
  return {
    mac: plateIcon(bird, MAC_PLATE),
    desktop: plateIcon(bird, ARTWORK_PLATE),
    glyph: glyph(bird),
    badge: badge(),
  }
}

const digest = (data) => createHash('sha256').update(data).digest('hex')
const sourceDigest = (sources) => digest(JSON.stringify(sources))

/** Width and height from a PNG's header. */
export function pngSize(png) {
  if (png.readUInt32BE(12) !== 0x49484452) throw new Error('not a PNG')
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/** `iconutil` stores the two smallest representations as ARGB, not PNG; their type names the size. */
const ARGB_WIDTH = { ic04: 16, ic05: 32 }

/** The image representations in an `.icns`, by type (`png` only for those stored as PNG). */
export function icnsEntries(icns) {
  const entries = []
  for (let at = 8; at < icns.length;) {
    const type = icns.toString('latin1', at, at + 4)
    const length = icns.readUInt32BE(at + 4)
    const data = icns.subarray(at + 8, at + length)
    if (data.readUInt32BE(0) === 0x89504e47)
      entries.push({ type, width: pngSize(data).width, png: data })
    else if (type in ARGB_WIDTH) entries.push({ type, width: ARGB_WIDTH[type] })
    at += length
  }
  return entries
}

/** The images in an `.ico` directory, in order (a stored 0 means 256). */
export function icoEntries(ico) {
  return Array.from({ length: ico.readUInt16LE(4) }, (_, index) => ({
    width: ico[6 + index * 16] || 256,
  }))
}

function tauriIcon(svg, dir, sizes = []) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'source.svg'), svg)
  const args = [
    'icon',
    join(dir, 'source.svg'),
    '-o',
    join(dir, 'out'),
    ...sizes.flatMap((size) => ['-p', `${size}`]),
  ]
  const result = run(TAURI, args)
  if (result.status !== 0) throw new Error(`tauri icon failed:\n${String(result.stderr)}`)
  return join(dir, 'out')
}

/** Draw every file into `dir` and return their names. */
function draw(sources, dir) {
  const work = mkdtempSync(join(tmpdir(), 'app-icons-'))
  try {
    const desktop = tauriIcon(sources.desktop, join(work, 'desktop'))
    for (const name of DESKTOP_FILES) copyFileSync(join(desktop, name), join(dir, name))
    const mac = tauriIcon(sources.mac, join(work, 'mac'), MAC_SIZES)
    const iconset = join(work, 'icon.iconset')
    mkdirSync(iconset)
    for (const [name, size] of ICONSET)
      copyFileSync(join(mac, `${size}x${size}.png`), join(iconset, name))
    const packed = run('iconutil', ['-c', 'icns', '-o', join(dir, 'icon.icns'), iconset])
    if (packed.status !== 0) throw new Error(`iconutil failed:\n${String(packed.stderr)}`)
    copyFileSync(
      join(tauriIcon(sources.glyph, join(work, 'glyph'), [36]), '36x36.png'),
      join(dir, 'tray-template.png'),
    )
    copyFileSync(
      join(tauriIcon(sources.badge, join(work, 'badge'), [32]), '32x32.png'),
      join(dir, 'badge-overlay.png'),
    )
    return [...DESKTOP_FILES, 'icon.icns', 'tray-template.png', 'badge-overlay.png'].toSorted()
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** Replace the set in `dir` (the app's own unless a caller previews elsewhere) with a fresh drawing. */
export function writeAppIcons(dir = ICONS_DIR) {
  if (process.platform !== 'darwin')
    throw new Error('--write needs macOS: the .icns is packed by iconutil')
  const sources = composeSources()
  for (const name of readdirSync(dir)) rmSync(join(dir, name), { recursive: true })
  const files = draw(sources, dir)
  const manifest = {
    generator: 'scripts/app-icons.mjs',
    source: sourceDigest(sources),
    files: Object.fromEntries(files.map((name) => [name, digest(readFileSync(join(dir, name)))])),
  }
  writeFileSync(join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
  return files
}

/** `undefined` when the set in `dir` is what the generator made from `bird`, else what is wrong. */
export function checkAppIcons({ bird = readBird(), dir = ICONS_DIR } = {}) {
  const fix = 'Run: bun scripts/app-icons.mjs --write'
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8'))
  } catch {
    return `the icon set has no ${MANIFEST}. ${fix}`
  }
  if (manifest.source !== sourceDigest(composeSources(bird))) {
    return `the icon set is stale: assets/logo.svg or the icon geometry changed since it was drawn. ${fix}`
  }
  const present = readdirSync(dir)
    .filter((name) => name !== MANIFEST)
    .toSorted()
  const expected = Object.keys(manifest.files).toSorted()
  const odd = [
    ...present.filter((name) => !expected.includes(name)),
    ...expected.filter((name) => !present.includes(name)),
  ]
  if (odd.length > 0)
    return `the icon set has unexpected or missing files: ${odd.join(', ')}. ${fix}`
  const edited = expected.filter(
    (name) => digest(readFileSync(join(dir, name))) !== manifest.files[name],
  )
  if (edited.length > 0) return `generated icons were changed by hand: ${edited.join(', ')}. ${fix}`
  return undefined
}

function main() {
  const mode = process.argv[2]
  if (mode === '--write') {
    console.log(`[app-icons] drew ${writeAppIcons().join(', ')}`)
  } else if (mode === '--check') {
    const problem = checkAppIcons()
    if (problem) {
      console.error(`[app-icons] ${problem}`)
      process.exitCode = 1
    } else console.log('[app-icons] the icon set matches its vector source')
  } else {
    console.error('usage: app-icons.mjs --write | --check')
    process.exitCode = 2
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
