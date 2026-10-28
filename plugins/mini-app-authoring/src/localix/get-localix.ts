import { createHash, randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { checksumOf, RELEASES } from '../kit/resolve'
import { UserError } from '../lib/errors'
import { installedLocalixApp } from './runtime'

/**
 * Installing Localix itself: the latest release's installer for this computer, verified against the
 * release's `SHA256SUMS.txt` before anything is opened. On macOS the app is copied out of the disk
 * image into `/Applications` (or `~/Applications` when that is not writable) and opened; on Linux
 * the AppImage is kept in `~/Applications` and made executable.
 */

export interface GetLocalixDeps {
  env?: Record<string, string | undefined>
  home?: string
  fetch?: typeof fetch
  platform?: NodeJS.Platform
  arch?: string
  /** Runs a system command; the default spawns it and throws on a non-zero exit. */
  exec?: (command: string[]) => Promise<void>
  /** The installed app, when the caller already looked (tests pass one, or null). */
  app?: string | null
  /** Where a new app goes; the default is `/Applications`, else `~/Applications`. */
  applications?: string
}

export interface GotLocalix {
  path: string
  /** Already installed: nothing was downloaded. */
  existing: boolean
}

/** The stable installer name a release publishes for this computer, or null. */
export function installerFor(platform: NodeJS.Platform, arch: string): string | null {
  const cpu = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'x64' : null
  if (!cpu) return null
  if (platform === 'darwin') return `Localix-macos-${cpu}.dmg`
  if (platform === 'linux') return `Localix-linux-${cpu}.AppImage`
  return null
}

const defaultExec = async (command: string[]) => {
  const child = Bun.spawn(command, { stdout: 'ignore', stderr: 'pipe' })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (code !== 0) throw new UserError(`${command[0]} failed: ${stderr.trim() || `exit ${code}`}`)
}

async function download(base: string, file: string, fetchImpl: typeof fetch): Promise<Uint8Array> {
  const sums = await fetchImpl(`${base}/SHA256SUMS.txt`)
  if (!sums.ok) throw new UserError(`Could not read the release checksums (HTTP ${sums.status}).`)
  const expected = checksumOf(await sums.text(), file)
  if (!expected) throw new UserError(`The latest Localix release has no ${file}.`)
  const response = await fetchImpl(`${base}/${file}`)
  if (!response.ok) throw new UserError(`Could not download ${file} (HTTP ${response.status}).`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new UserError(`${file} does not match its published checksum; it was not installed.`)
  }
  return bytes
}

async function writable(dir: string): Promise<boolean> {
  return fs.access(dir, fs.constants.W_OK).then(
    () => true,
    () => false,
  )
}

/** Install the latest Localix unless it is already installed; opens it either way on macOS. */
export async function getLocalix(deps: GetLocalixDeps = {}): Promise<GotLocalix> {
  const env = deps.env ?? process.env
  const home = deps.home ?? homedir()
  const platform = deps.platform ?? process.platform
  const exec = deps.exec ?? defaultExec
  const file = installerFor(platform, deps.arch ?? process.arch)
  if (!file) {
    throw new UserError(
      `Localix publishes no installer for ${platform}/${deps.arch ?? process.arch}; see https://github.com/rsaryev/localix/releases.`,
    )
  }
  const base = env.LOCALIX_RELEASES?.trim() || RELEASES

  if (platform === 'linux') {
    const target = join(home, 'Applications', 'Localix.AppImage')
    if (existsSync(target)) return { path: target, existing: true }
    const bytes = await download(base, file, deps.fetch ?? fetch)
    await fs.mkdir(join(home, 'Applications'), { recursive: true })
    await fs.writeFile(target, bytes, { mode: 0o755 })
    return { path: target, existing: false }
  }

  const installed = deps.app === undefined ? installedLocalixApp(home) : deps.app
  if (installed) {
    await exec(['open', installed])
    return { path: installed, existing: true }
  }
  const bytes = await download(base, file, deps.fetch ?? fetch)
  const work = join(tmpdir(), `localix-install-${randomUUID()}`)
  const mount = join(work, 'mount')
  await fs.mkdir(mount, { recursive: true })
  const dmg = join(work, file)
  await fs.writeFile(dmg, bytes)
  const applications =
    deps.applications ??
    ((await writable('/Applications')) ? '/Applications' : join(home, 'Applications'))
  const target = join(applications, 'Localix.app')
  try {
    await exec(['hdiutil', 'attach', '-nobrowse', '-readonly', '-mountpoint', mount, dmg])
    try {
      await fs.mkdir(applications, { recursive: true })
      // ditto keeps the signature, the extended attributes and the symlinks of the bundle.
      await exec(['ditto', join(mount, 'Localix.app'), target])
    } finally {
      await exec(['hdiutil', 'detach', mount, '-quiet']).catch(() => undefined)
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true })
  }
  await exec(['open', target])
  return { path: target, existing: false }
}
