// A catalog of mini apps as the store reads it (`apps/api/src/features/mini-apps/catalog-feed.ts`):
// one gzip tarball per app whose root is the app's staged folder, and `mini-app-catalog.json`
// naming each archive beside it with its size and sha256. Archive URLs are relative, so the
// catalog and its archives are published together — a release's assets, a folder, any host.
import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export const CATALOG_FILE = 'mini-app-catalog.json'
export const CATALOG_SCHEMA = 1

/**
 * What an archive never carries: where a copy came from (`.localix-install.json`, the managed
 * marker), version control, dependencies (the host serves the shared modules; a built backend is
 * one bundled file) and build caches.
 */
const LEFT_BEHIND = (name) =>
  name.startsWith('.localix-') || ['node_modules', '.git', '.turbo', '.DS_Store'].includes(name)

/** Every regular file under `dir`, keyed by its forward-slash path relative to `dir`. */
function filesOf(dir) {
  /** @type {Record<string, Uint8Array>} */
  const files = {}
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (LEFT_BEHIND(entry.name)) continue
      const path = join(current, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files[relative(dir, path).split(sep).join('/')] = readFileSync(path)
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
 *   log?: (line: string) => void,
 * }} options
 */
export async function packMiniAppCatalog({
  stagedRoot,
  outDir,
  publisher = { name: 'Localix', verified: true },
  unavailable = {},
  only,
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

    const bytes = await new Bun.Archive(filesOf(dir), { compress: 'gzip' }).bytes()
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
      archive: { url: file, bytes: bytes.byteLength, sha256 },
    })
    log(`packed ${name} ${version} (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB)`)
  }
  const catalog = { schema: CATALOG_SCHEMA, apps }
  writeFileSync(join(outDir, CATALOG_FILE), `${JSON.stringify(catalog, null, 2)}\n`)
  return catalog
}
