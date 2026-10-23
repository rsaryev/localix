import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { archiveOnly } from '../../../scripts/screenshots/plan.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')
const defaultShotsDir = path.join(repoRoot, 'docs/assets/screenshots')
const defaultOutFile = path.resolve(__dirname, '../src/generated/shots.ts')
const defaultPublicDir = path.resolve(__dirname, '../public/shots')
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const REQUIRED_WIDTH = 1600
const REQUIRED_HEIGHT = 1000
const SAFE_SEGMENT = /^[0-9a-z]+(?:-[0-9a-z]+)*$/u
const DATED_FILE = /^(?<surface>[0-9a-z]+(?:-[0-9a-z]+)*)--(?<date>\d{4}-\d{2}-\d{2})\.png$/u
// A reserved slot: the real capture is not taken yet, so the file is a stand-in. It is never a
// dated capture (no date, no freshness claim) and a dated capture of the same key replaces it.
const PLACEHOLDER_FILE = /^(?<surface>[0-9a-z]+(?:-[0-9a-z]+)*)--placeholder\.png$/u

export function pngDimensions(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG file')
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

function isIsoDate(value) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

async function walkPngs(dir) {
  const files = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walkPngs(absolute)))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) files.push(absolute)
  }
  return files
}

function importPath(fromFile, assetFile) {
  const relative = path.relative(path.dirname(fromFile), assetFile).split(path.sep).join('/')
  return relative.startsWith('.') ? relative : `./${relative}`
}

async function writeAtomically(file, source) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  try {
    await fs.writeFile(temporary, source, 'utf8')
    await fs.rename(temporary, file)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

/**
 * The pre-rendered documentation cannot know the content-hashed URL Vite gives an imported PNG:
 * the pre-rendered `src` and the hydrated one would differ and the picture would reload at
 * hydration. The current captures are copied under `public/shots/` and addressed by a plain path
 * both renderers agree on.
 */
async function copyPublicShots({ latest, publicDir }) {
  await fs.rm(publicDir, { recursive: true, force: true })
  for (const shot of latest) {
    const target = path.join(publicDir, `${shot.key}--${shot.capturedAt}.png`)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(shot.file, target)
  }
}

export async function buildShotManifest({
  shotsDir = defaultShotsDir,
  archiveKeys = archiveOnly,
  outFile = defaultOutFile,
  // Opt-in: without a public directory only the docs manifest is written.
  publicDir,
} = {}) {
  const files = await walkPngs(shotsDir)
  const all = []
  const placeholderFiles = []

  for (const file of files) {
    const relative = path.relative(shotsDir, file)
    const parts = relative.split(path.sep)
    if (parts.length < 2 || parts.slice(0, -1).some((part) => !SAFE_SEGMENT.test(part))) {
      throw new Error(`Screenshot path must be <feature>/<surface>--YYYY-MM-DD.png: ${relative}`)
    }

    const placeholder = PLACEHOLDER_FILE.exec(parts.at(-1))
    const match = placeholder ? null : DATED_FILE.exec(parts.at(-1))
    if (!placeholder && (!match?.groups || !isIsoDate(match.groups.date))) {
      throw new Error(`Screenshot filename must end in a valid --YYYY-MM-DD date: ${relative}`)
    }

    const dimensions = pngDimensions(await fs.readFile(file))
    const width = REQUIRED_WIDTH
    const height = REQUIRED_HEIGHT
    const density = dimensions.width / width
    const validDensity = Number.isInteger(density) && density >= 1 && density <= 3
    if (!validDensity || dimensions.height !== height * density || (placeholder && density !== 1)) {
      throw new Error(
        `${relative} must be ${width}×${height}${placeholder ? '' : ' at 1×, 2×, or 3× density'}; got ${dimensions.width}×${dimensions.height}`,
      )
    }

    if (placeholder?.groups) {
      placeholderFiles.push({
        key: [...parts.slice(0, -1), placeholder.groups.surface].join('/'),
        file,
      })
      continue
    }

    const key = [...parts.slice(0, -1), match.groups.surface].join('/')
    if (archiveKeys.includes(key)) continue
    all.push({
      key,
      capturedAt: match.groups.date,
      file,
      repoPath: `docs/assets/screenshots/${relative.split(path.sep).join('/')}`,
    })
  }

  all.sort((a, b) => a.key.localeCompare(b.key) || b.capturedAt.localeCompare(a.capturedAt))
  const latest = []
  const seen = new Set()
  for (const shot of all) {
    if (seen.has(shot.key)) continue
    seen.add(shot.key)
    latest.push(shot)
  }

  const capturedKeys = new Set(latest.map((shot) => shot.key))
  const placeholders = placeholderFiles
    .filter((slot) => !capturedKeys.has(slot.key))
    .sort((a, b) => a.key.localeCompare(b.key))

  const imports = (publicDir ? [] : latest)
    .map(
      (shot, index) => `import shot${index} from ${JSON.stringify(importPath(outFile, shot.file))}`,
    )
    .join('\n')
  const sourceOf = (shot, index) =>
    publicDir ? JSON.stringify(`/shots/${shot.key}--${shot.capturedAt}.png`) : `shot${index}`
  const entries = latest
    .map(
      (shot, index) =>
        `  ${JSON.stringify(shot.key)}: { src: ${sourceOf(shot, index)}, capturedAt: ${JSON.stringify(shot.capturedAt)} },`,
    )
    .join('\n')
  const assetEntries = latest
    .map(
      (shot, index) =>
        `  ${JSON.stringify(shot.repoPath)}: { src: ${sourceOf(shot, index)}, capturedAt: ${JSON.stringify(shot.capturedAt)} },`,
    )
    .join('\n')
  const names = latest.map((shot) => shot.key)
  const source = `// AUTO-GENERATED by scripts/build-shots.mjs — do not edit by hand.
${imports}${imports ? '\n\n' : ''}export const availableShots = {
${entries}
} as const
export const availableShotNames = ${JSON.stringify(names)} as const
export const screenshotAssets = {
${assetEntries}
} as const
`

  await writeAtomically(outFile, source)
  if (publicDir) {
    await copyPublicShots({ latest, publicDir })
  }

  console.log(
    `[shots:gen] selected ${latest.length} current capture(s) from ${all.length} dated file(s); ${placeholders.length} placeholder slot(s) awaiting a capture`,
  )
  return latest.map(({ key, capturedAt }) => ({ key, capturedAt }))
}

if (import.meta.main) {
  buildShotManifest({ publicDir: defaultPublicDir }).catch((error) => {
    console.error('[shots:gen] failed:', error)
    process.exit(1)
  })
}
