// Generate the Tauri config overlay that makes a build an UPDATING release build.
//
//   bun scripts/build-release-config.mjs [--out <file>]   write the overlay (default below)
//   bun scripts/build-release-config.mjs --pubkey         print the updater public key in effect
//
// The base `src-tauri/tauri.conf.json` carries no updater configuration, and the updater is not
// compiled into the app either (`build.rs`, `LOCALIX_UPDATER_ENABLED`). A build from a checkout, a
// local `tauri build` or a fork's CI therefore cannot check, download or install anything from the
// official release feed: with the committed key and endpoint in the base config, every such build
// (version 0.0.1) read "an update is available" and offered to replace itself with the official one.
//
// A release build gets the updater from this overlay, which `run-tauri.mjs --release` passes as an
// extra `--config`. Its values are the committed `updater.release.json`, each overridable from the
// environment so a channel or a fork can point somewhere else without editing the repository:
//
//   LOCALIX_UPDATER_PUBKEY      the minisign public key, as `tauri signer generate` writes the .pub
//   LOCALIX_UPDATER_ENDPOINTS   comma-separated https URLs of the update manifest (`latest.json`)
//
// Tauri merges an overlay by RFC 7396: an array in it REPLACES the base's, whole. That is why this
// overlay is allowed exactly three keys and nothing else; one stray `externalBin` or `resources`
// would silently drop the sidecar from the bundle. `assertOverlaySafe` enforces it.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const UPDATER_SETTINGS_FILE = join(desktop, 'updater.release.json')
export const RELEASE_CONFIG_FILE = join(desktop, 'src-tauri', 'tauri.release.generated.conf.json')

/** The only places the overlay may write. Anything else is refused. */
const ALLOWED_PATHS = [
  'bundle.createUpdaterArtifacts',
  'plugins.updater.pubkey',
  'plugins.updater.endpoints',
]

/** A minisign public key as the Tauri signer writes it: base64 of a two-line `.pub` file. */
export function assertPubkey(pubkey) {
  if (typeof pubkey !== 'string' || pubkey.trim() === '')
    throw new Error('The updater public key is empty')
  const text = Buffer.from(pubkey.trim(), 'base64').toString('utf8')
  const [comment, key] = text.split('\n')
  if (
    !comment?.startsWith('untrusted comment: minisign public key:') ||
    !/^RW[A-Za-z0-9+/]{54,}={0,2}$/u.test(key ?? '')
  ) {
    throw new Error(
      'The updater public key is not a base64 minisign public key (the .pub file as written by `tauri signer generate`)',
    )
  }
  return pubkey.trim()
}

/** HTTPS only: the plugin refuses plain http, and a feed over http could be rewritten in transit. */
export function assertEndpoints(endpoints) {
  if (!Array.isArray(endpoints) || endpoints.length === 0)
    throw new Error('The updater has no endpoints')
  for (const endpoint of endpoints) {
    let url
    try {
      url = new URL(endpoint)
    } catch {
      throw new Error(`Updater endpoint is not a URL: ${JSON.stringify(endpoint)}`)
    }
    if (url.protocol !== 'https:') throw new Error(`Updater endpoint must be https: ${endpoint}`)
  }
  return endpoints
}

/** The committed settings, with each value replaced by its environment override when one is set. */
export function readUpdaterSettings({ env = process.env, file = UPDATER_SETTINGS_FILE } = {}) {
  const committed = JSON.parse(readFileSync(file, 'utf8'))
  const endpointsOverride = env.LOCALIX_UPDATER_ENDPOINTS?.split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return {
    pubkey: assertPubkey(env.LOCALIX_UPDATER_PUBKEY?.trim() || committed.pubkey),
    endpoints: assertEndpoints(endpointsOverride?.length ? endpointsOverride : committed.endpoints),
  }
}

/** The overlay for these settings. */
export function renderReleaseConfig({ pubkey, endpoints }) {
  return {
    $schema: 'https://schema.tauri.app/config/2',
    bundle: { createUpdaterArtifacts: true },
    plugins: { updater: { pubkey, endpoints } },
  }
}

/** Every leaf path of a JSON value, `a.b.c` style (an array is a leaf: it is replaced whole). */
function leafPaths(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    key === '$schema' && prefix === '' ? [] : leafPaths(child, prefix ? `${prefix}.${key}` : key),
  )
}

/** Throw when the overlay writes anywhere but the allowed paths (see the header: merge clobbers). */
export function assertOverlaySafe(overlay) {
  const stray = leafPaths(overlay).filter((path) => !ALLOWED_PATHS.includes(path))
  if (stray.length > 0) throw new Error(`The release overlay may not set: ${stray.join(', ')}`)
  return overlay
}

/** Write the overlay and return its path. */
export function writeReleaseConfig({ out = RELEASE_CONFIG_FILE, env = process.env } = {}) {
  const overlay = assertOverlaySafe(renderReleaseConfig(readUpdaterSettings({ env })))
  writeFileSync(out, `${JSON.stringify(overlay, null, 2)}\n`)
  return out
}

/** Throw unless `binary` contains the public key: a release build whose updater was left out. */
export function assertUpdaterEmbedded(binaryPath, pubkey) {
  if (!readFileSync(binaryPath).includes(Buffer.from(pubkey))) {
    throw new Error(
      `${binaryPath} does not contain the updater public key: this build would never update. ` +
        'Check that LOCALIX_UPDATER_ENABLED=1 reached cargo and the release overlay was applied.',
    )
  }
}

function main() {
  const args = process.argv.slice(2)
  try {
    if (args.includes('--pubkey')) {
      process.stdout.write(readUpdaterSettings().pubkey)
      return
    }
    const at = args.indexOf('--out')
    const out = writeReleaseConfig({ out: at === -1 ? RELEASE_CONFIG_FILE : resolve(args[at + 1]) })
    console.log(`[release-config] wrote ${out}`)
  } catch (error) {
    console.error(`[release-config] ${error.message}`)
    process.exitCode = 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
