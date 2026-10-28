import { createHash, randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { UserError } from '../lib/errors'
import { isPathBelow } from '../lib/paths'
import {
  findLocalix,
  installedLocalixApp,
  localixRequest,
  type LocalixRuntime,
} from '../localix/runtime'
import { KIT_MANIFEST } from './kit'

/**
 * Which kit to build with, in order of how exactly it matches the Localix the app will run in:
 *
 * 1. `MINI_APP_KIT` (or `--kit`): a kit someone named.
 * 2. The running Localix's own kit (`GET /rpc/mini-apps/kit`): exactly what will run the app.
 * 3. The kit inside an installed Localix app, when Localix is not running.
 * 4. The latest Localix release's kit, downloaded once, verified against the release's
 *    `SHA256SUMS.txt` and kept by its hash: so Claude Code without Localix can still create, build
 *    and share a mini app.
 */

export const KIT_ARCHIVE = 'mini-app-kit.tar.gz'
/** Localix's repository: its releases carry the kit, its tags the toolchain. */
export const LOCALIX_REPO = 'rsaryev/localix'
export const RELEASES = `https://github.com/${LOCALIX_REPO}/releases/latest/download`

export interface KitSource {
  dir: string
  /** Where the kit came from, for the report. */
  from: 'named' | 'localix' | 'app' | 'release'
}

export interface ResolveKitDeps {
  env?: Record<string, string | undefined>
  home?: string
  fetch?: typeof fetch
  /** The running Localix, when the caller already looked. */
  runtime?: LocalixRuntime | null
  /** The installed app, when the caller already looked (tests pass null). */
  app?: string | null
  /** Never download: fall back to the newest kit already downloaded (an edit hook must be quick). */
  offline?: boolean
}

/** Where downloaded kits are kept: the plugin's data folder, else the user's cache. */
export function kitCacheRoot(env: Record<string, string | undefined>, home: string): string {
  const data = env.CLAUDE_PLUGIN_DATA?.trim()
  return data ? join(data, 'kits') : join(home, '.cache', 'localix-mini-app-authoring', 'kits')
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** The kit's line in a `SHA256SUMS.txt`: `<hex>  <file>`. */
export function checksumOf(sums: string, file: string): string | null {
  for (const line of sums.split('\n')) {
    const [hash, name] = line.trim().split(/\s+\*?/u)
    if (name === file && hash && /^[0-9a-f]{64}$/u.test(hash)) return hash
  }
  return null
}

async function downloadKit(
  base: string,
  cacheRoot: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const sumsResponse = await fetchImpl(`${base}/SHA256SUMS.txt`)
  if (!sumsResponse.ok) {
    throw new UserError(
      `Could not read the Localix release checksums (${base}/SHA256SUMS.txt: HTTP ${sumsResponse.status}).`,
    )
  }
  const expected = checksumOf(await sumsResponse.text(), KIT_ARCHIVE)
  if (!expected) throw new UserError(`The latest Localix release publishes no ${KIT_ARCHIVE}.`)
  const dir = join(cacheRoot, expected.slice(0, 16))
  if (existsSync(join(dir, KIT_MANIFEST))) return dir

  const response = await fetchImpl(`${base}/${KIT_ARCHIVE}`)
  if (!response.ok) {
    throw new UserError(`Could not download ${KIT_ARCHIVE} (HTTP ${response.status}).`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (sha256(bytes) !== expected) {
    throw new UserError(`${KIT_ARCHIVE} does not match its published checksum; nothing was kept.`)
  }
  const staging = join(cacheRoot, `.unpack-${randomUUID()}`)
  await fs.mkdir(staging, { recursive: true })
  try {
    for (const [path, file] of await new Bun.Archive(bytes).files()) {
      const target = join(staging, path)
      if (!isPathBelow(staging, target)) {
        throw new UserError(`${KIT_ARCHIVE} names a path outside itself: ${path}`)
      }
      await Bun.write(target, file)
    }
    if (!existsSync(join(staging, KIT_MANIFEST))) {
      throw new UserError(`${KIT_ARCHIVE} has no ${KIT_MANIFEST} at its root.`)
    }
    await fs.rm(dir, { recursive: true, force: true })
    await fs.rename(staging, dir)
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
  return dir
}

export async function resolveKit(deps: ResolveKitDeps = {}): Promise<KitSource> {
  const env = deps.env ?? process.env
  const home = deps.home ?? homedir()
  const fetchImpl = deps.fetch ?? fetch

  const named = env.MINI_APP_KIT?.trim()
  if (named) return { dir: named, from: 'named' }

  const runtime =
    deps.runtime === undefined ? await findLocalix({ env, home, fetch: fetchImpl }) : deps.runtime
  // A Localix from before the toolchain moved out has no kit route, and its kit (like the installed
  // app's, the same release) cannot build for this toolchain: the latest release's is used instead.
  const running = runtime
    ? await localixRequest<{ dir: string }>(runtime, '/rpc/mini-apps/kit', {}, fetchImpl).then(
        ({ dir }) => dir,
        () => null,
      )
    : undefined
  if (running) return { dir: running, from: 'localix' }

  if (running === undefined) {
    const app = deps.app === undefined ? installedLocalixApp(home) : deps.app
    const bundled = app && join(app, 'Contents', 'Resources', 'resources', 'mini-app-kit')
    if (bundled && (await speaksAuthoring(bundled))) return { dir: bundled, from: 'app' }
  }

  if (deps.offline) {
    const cached = await newestCachedKit(kitCacheRoot(env, home))
    if (cached) return { dir: cached, from: 'release' }
    throw new UserError('No mini app kit on this computer yet; any mini-app command downloads one.')
  }
  const base = env.MINI_APP_KIT_RELEASES?.trim() || RELEASES
  return { dir: await downloadKit(base, kitCacheRoot(env, home), fetchImpl), from: 'release' }
}

/** The kit at `dir` carries the authoring block this toolchain reads (an older app's does not). */
async function speaksAuthoring(dir: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await fs.readFile(join(dir, KIT_MANIFEST), 'utf8'))
    return typeof manifest?.authoring?.tools === 'string'
  } catch {
    return false
  }
}

async function newestCachedKit(cacheRoot: string): Promise<string | null> {
  const entries = await fs.readdir(cacheRoot, { withFileTypes: true }).catch(() => [])
  let newest: { dir: string; at: number } | null = null
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = join(cacheRoot, entry.name)
    const stat = await fs.stat(join(dir, KIT_MANIFEST)).catch(() => null)
    if (stat && (!newest || stat.mtimeMs > newest.at)) newest = { dir, at: stat.mtimeMs }
  }
  return newest?.dir ?? null
}
