// A catalog of mini apps as the store reads it (`apps/api/src/features/mini-apps/catalog-feed.ts`):
// one gzip tarball per app whose root is the app's staged folder, and `mini-app-catalog.json`
// naming each archive beside it with its size and sha256. Archive URLs are relative, so the
// catalog and its archives are published together — a release's assets, a folder, any host.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, sep } from 'node:path'

import {
  checkMiniAppMedia,
  isAppRelativePath,
  mediaExtension,
  MINI_APP_ICON_TYPES,
  MINI_APP_SCREENSHOT_TYPES,
} from '../../packages/mini-app-sdk/src/manifest/media.ts'

export const CATALOG_FILE = 'mini-app-catalog.json'
/**
 * Which first-party apps the Localix catalog features at the top of the store, and which a new
 * installation gets on its own (`apps/api/src/features/mini-apps/recommended.ts`). One list beside
 * the apps: the release writes it into the catalog, and staging copies it next to the staged apps,
 * where the development store reads it (`store-offers.ts` `CATALOG_PICKS_FILE`).
 */
export const CATALOG_PICKS_FILE = 'catalog-picks.json'

/** The checkout's picks; a list that is missing or not one is empty. */
export function readCatalogPicks(repoRoot) {
  const names = (value) =>
    Array.isArray(value) ? value.filter((name) => typeof name === 'string') : []
  try {
    const parsed = JSON.parse(readFileSync(join(repoRoot, 'mini-apps', CATALOG_PICKS_FILE), 'utf8'))
    return { featured: names(parsed?.featured), recommended: names(parsed?.recommended) }
  } catch {
    return { featured: [], recommended: [] }
  }
}
export const CATALOG_SCHEMA = 1
/** The app's README, published as its store page's About; longer than this is not a README. */
const README_FILE = 'README.md'
const README_MAX_BYTES = 512 * 1024

/**
 * What an archive never carries: where a copy came from (`.localix-install.json`, the managed
 * marker), version control, dependencies (the host serves the shared modules; a built backend is
 * one bundled file) and build caches.
 */
const LEFT_BEHIND = (name) =>
  name.startsWith('.localix-') || ['node_modules', '.git', '.turbo', '.DS_Store'].includes(name)

/**
 * Every regular file under `dir`, keyed by its forward-slash path relative to `dir`, but the ones
 * in `skip` (the screenshots, which a catalog publishes beside the archive instead).
 */
function filesOf(dir, skip = new Set()) {
  /** @type {Record<string, Uint8Array>} */
  const files = {}
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (LEFT_BEHIND(entry.name)) continue
      const path = join(current, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) {
        const key = relative(dir, path).split(sep).join('/')
        if (!skip.has(key)) files[key] = readFileSync(path)
      }
      // A symlink or a device cannot be unpacked safely on another machine; staging makes none.
      else if (!lstatSync(path).isDirectory())
        throw new Error(
          `${relative(dir, path)} is not a regular file; a mini app archive holds only files`,
        )
    }
  }
  visit(dir)
  return files
}

const text = (value) => (typeof value === 'string' && value.trim() ? value : undefined)
const sha256Of = (bytes) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
const withoutDot = (path) => path.replace(/^\.\//, '')

/** One file of the app by its manifest path, or null; never one outside the folder. */
function readInside(dir, path) {
  if (!isAppRelativePath(path)) return null
  const target = join(dir, withoutDot(path))
  if (!existsSync(target) || !statSync(target).isFile()) return null
  const real = realpathSync(target)
  if (relative(realpathSync(dir), real).startsWith('..')) return null
  return new Uint8Array(readFileSync(real))
}

/**
 * Write one media file beside the archive, named `<app>-<version>-<label>-<hash>.<ext>` so a
 * catalog that changes never serves new bytes under an old name, and say where it is.
 */
function publish(outDir, app, label, bytes, ext) {
  const sha256 = sha256Of(bytes)
  const file = `${app.name}-${app.version}-${label}-${sha256.slice(0, 12)}.${ext}`
  writeFileSync(join(outDir, file), bytes)
  return { url: file, bytes: bytes.byteLength, sha256 }
}

/** The store's view of the app: its media published beside the archive, and what it declares. */
function storeFields(dir, manifest, outDir, app) {
  const fields = {}
  const iconBytes = readInside(dir, manifest.icon)
  const iconExt = mediaExtension(manifest.icon)
  fields.icon = {
    ...publish(outDir, app, 'icon', iconBytes, iconExt),
    type: MINI_APP_ICON_TYPES[iconExt],
  }
  const screenshots = (manifest.screenshots ?? []).map((shot, index) => {
    const ext = mediaExtension(shot.path)
    return {
      ...publish(outDir, app, `screenshot-${index + 1}`, readInside(dir, shot.path), ext),
      type: MINI_APP_SCREENSHOT_TYPES[ext],
      ...(text(shot.caption) ? { caption: shot.caption } : {}),
    }
  })
  if (screenshots.length) fields.screenshots = screenshots
  const readme = readInside(dir, README_FILE)
  if (readme && readme.byteLength <= README_MAX_BYTES)
    fields.readme = publish(outDir, app, 'readme', readme, 'md')
  if (Array.isArray(manifest.tags) && manifest.tags.length) fields.tags = manifest.tags
  for (const key of ['homepage', 'license']) if (text(manifest[key])) fields[key] = manifest[key]
  const author = text(manifest.author) ?? text(manifest.author?.name)
  if (author) fields.author = author
  if (Array.isArray(manifest.surfaces)) fields.surfaces = manifest.surfaces
  const commands = Object.keys(manifest.commands ?? {})
  if (commands.length) fields.commands = commands
  return fields
}

/**
 * Pack every app in `stagedRoot` (what `stageDropins` writes) into `outDir` and write the catalog
 * there. A private app (the template), one the staging marked unavailable and one not in `only`
 * are left out. Returns the catalog.
 *
 * @param {{
 *   stagedRoot: string,
 *   outDir: string,
 *   publisher?: { name: string, verified: boolean },
 *   unavailable?: Record<string, string>,
 *   only?: string[],
 *   featured?: string[],
 *   recommended?: string[],
 *   log?: (line: string) => void,
 * }} options
 */
export async function packMiniAppCatalog({
  stagedRoot,
  outDir,
  publisher = { name: 'Localix', verified: true },
  unavailable = {},
  only,
  featured = [],
  recommended = [],
  log = () => {},
}) {
  mkdirSync(outDir, { recursive: true })
  const apps = []
  const folders = readdirSync(stagedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
  for (const folder of folders) {
    const dir = join(stagedRoot, folder)
    let manifest
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'mini-app.json'), 'utf8'))
    } catch {
      continue
    }
    const name = text(manifest.name)
    const version = text(manifest.version)
    if (!name || manifest.private === true) continue
    if (only && !only.includes(name)) continue
    if (unavailable[name]) {
      log(`skipped ${name}: ${unavailable[name]}`)
      continue
    }
    if (!version) throw new Error(`${name} has no version; a catalog app must declare one`)
    // A catalog shows every app by its icon: refuse to publish one without a valid icon.
    const problems = await checkMiniAppMedia(manifest, async (path) => readInside(dir, path), {
      requireIcon: true,
    })
    if (problems.length) throw new Error(`${name}: ${problems.join('; ')}`)

    const screenshotFiles = new Set(
      (manifest.screenshots ?? []).map((shot) => withoutDot(shot.path)),
    )
    const bytes = await new Bun.Archive(filesOf(dir, screenshotFiles), { compress: 'gzip' }).bytes()
    const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
    // The hash in the name: a client holding an older catalog asks for a file that is gone (404),
    // never for one whose bytes changed under the same name.
    const file = `${name}-${version}-${sha256.slice(0, 12)}.tar.gz`
    writeFileSync(join(outDir, file), bytes)
    apps.push({
      name,
      ...(text(manifest.displayName) ? { displayName: manifest.displayName } : {}),
      description: text(manifest.description) ?? '',
      ...(text(manifest.category) ? { category: manifest.category } : {}),
      version,
      ...(typeof manifest.apiVersion === 'number' ? { apiVersion: manifest.apiVersion } : {}),
      publisher,
      ...storeFields(dir, manifest, outDir, { name, version }),
      ...(featured.includes(name) ? { featured: true } : {}),
      ...(recommended.includes(name) ? { recommended: true } : {}),
      archive: { url: file, bytes: bytes.byteLength, sha256 },
    })
    log(`packed ${name} ${version} (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB)`)
  }
  const catalog = { schema: CATALOG_SCHEMA, apps }
  writeFileSync(join(outDir, CATALOG_FILE), `${JSON.stringify(catalog, null, 2)}\n`)
  return catalog
}
