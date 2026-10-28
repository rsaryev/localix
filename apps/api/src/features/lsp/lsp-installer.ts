import { existsSync } from 'node:fs'
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

import { DownloadError, downloadPinned, type DownloadOptions } from '../../lib/pinned-download'
import { EXE_SUFFIX, which as whichOnPath } from './lsp-bin-resolve'
import {
  InstallFailure,
  runCommand,
  runOrFail,
  type CommandResult,
  type InstallCommand,
} from './lsp-install-command'
import { COMPLETE, markUsed, pruneUnused, STAGING } from './lsp-install-prune'
import {
  MINIMUM_RELEASE_AGE_S,
  npmManifest,
  SHIPPED_LOCKS,
  type LockfileMap,
  type NpmPackage,
} from './lsp-npm-lock'
import { LSP_PACKAGES, type LspPackage, type LspSource } from './lsp-registry'

/**
 * Installs a language server the first time it is needed, under one root
 * (`~/.localix/language-servers`):
 *
 *   <id>/<install key>/        a complete install; `.complete` inside is written last
 *   <id>/.staging-<key>-<n>/   an install in progress, renamed into place when it finishes
 *   .downloads/                transport only (a release archive before it is unpacked)
 *
 * The key changes whenever the package's entry in `language-servers.json` does, so a new version
 * installs beside the old one rather than over a running server. Older versions' folders are
 * removed only once nothing can be running from them: never one this process handed out, and never
 * one another process (a dev and a packaged Localix share this folder) launched within
 * `UNUSED_GRACE_MS`; each launch refreshes the modification time of the version's `.complete`.
 * A folder without `.complete` never counts as installed. An npm install writes the server's
 * shipped lockfile (`lsp-npm-lock.ts`) and installs from it frozen.
 * Concurrent requests for one package share one attempt; a failed attempt leaves nothing behind,
 * keeps the older version, and the next request tries again.
 */

export type LspInstallOutcome =
  | { ok: true; dir: string }
  | { ok: false; reason: 'offline' | 'needs-toolchain' | 'failed'; detail: string }

export interface LspInstaller {
  /** The install's folder when it is complete on disk. */
  installedDir(packageId: string): string | undefined
  /** Install once; `onProgress` gets a 0–1 fraction when the transport can tell. */
  install(packageId: string, onProgress?: (fraction: number) => void): Promise<LspInstallOutcome>
}

export type { InstallCommand } from './lsp-install-command'

export interface LspInstallerOptions {
  root: string
  packages?: Readonly<Record<string, LspPackage>>
  /** Test seam: run a command, resolving with its exit code and combined output. */
  run?: (call: InstallCommand) => Promise<CommandResult>
  which?: (command: string) => string | undefined
  fetchImpl?: typeof fetch
  /** Test seam: the download's no-progress watchdog. */
  download?: Pick<DownloadOptions, 'stallTimeoutMs' | 'setTimer'>
  /** `${process.platform}-${process.arch}`. */
  platform?: string
  /** The Bun that installs npm servers: the one running the API. */
  runtime?: string
  /** The shipped npm lockfiles by server id (`language-server-locks.json`). */
  locks?: LockfileMap
  /** Test seam: the clock that ages an unused version. */
  now?: () => Date
}

const exe = (name: string, platform: string) =>
  platform.startsWith('win32') ? `${name}.exe` : name

/** Where an install keeps a command that is not an npm bin (`managedNpmBin` finds those). */
export function installedExecutable(
  from: LspSource['type'],
  bin: string,
  installDir: string,
): string {
  return from === 'golang'
    ? path.join(installDir, 'bin', `${bin}${EXE_SUFFIX}`)
    : path.join(installDir, `${bin}${EXE_SUFFIX}`)
}

export function createLspInstaller(options: LspInstallerOptions): LspInstaller {
  const packages = options.packages ?? LSP_PACKAGES
  const run = options.run ?? ((call: InstallCommand) => runCommand(call))
  const which = options.which ?? whichOnPath
  const platform = options.platform ?? `${process.platform}-${process.arch}`
  const runtime = options.runtime ?? process.execPath
  const locks = options.locks ?? SHIPPED_LOCKS
  const now = options.now ?? (() => new Date())
  /** Folders this process handed out: a server here may be running from one. */
  const handedOut = new Set<string>()
  const inflight = new Map<string, Promise<LspInstallOutcome>>()
  const listeners = new Map<string, Set<(fraction: number) => void>>()
  let staging = 0

  function installKey(pkg: LspPackage): string {
    const pinned = JSON.stringify([pkg.source, pkg.with, pkg.assets[platform] ?? null])
    const hash = new Bun.CryptoHasher('sha256').update(pinned).digest('hex').slice(0, 8)
    return `${pkg.source.version}-${hash}`
  }

  const finalDir = (pkg: LspPackage) => path.join(options.root, pkg.id, installKey(pkg))

  const runChecked = (call: InstallCommand, what: string) => runOrFail(run, call, what)

  async function installNpm(pkg: NpmPackage, dir: string) {
    const lock = locks[pkg.id]
    if (lock === undefined)
      throw new InstallFailure(
        'failed',
        `${pkg.id} has no shipped lockfile; run lsp:update to resolve its dependencies`,
      )
    await writeFile(
      path.join(dir, 'package.json'),
      `${JSON.stringify(npmManifest(pkg), null, 2)}\n`,
    )
    await writeFile(path.join(dir, 'bun.lock'), lock)
    await runChecked(
      {
        command: runtime,
        args: [
          'install',
          '--ignore-scripts',
          '--production',
          '--frozen-lockfile',
          `--minimum-release-age=${MINIMUM_RELEASE_AGE_S}`,
        ],
        cwd: dir,
      },
      `Installing ${pkg.source.name}@${pkg.source.version}`,
    )
  }

  async function installGo(pkg: LspPackage & { source: { type: 'golang' } }, dir: string) {
    const go = which('go')
    if (!go) throw new InstallFailure('needs-toolchain', 'Go')
    const { module, version } = pkg.source
    await runChecked(
      {
        command: go,
        args: ['install', `${module}@${version}`],
        cwd: dir,
        env: { GOBIN: path.join(dir, 'bin') },
      },
      `Building ${module}@${version}`,
    )
  }

  async function installRelease(
    pkg: LspPackage & { source: { type: 'github' } },
    dir: string,
    progress: (f: number) => void,
  ) {
    const asset = pkg.assets[platform]
    const bin = pkg.bin[0]!
    if (!asset) throw new InstallFailure('failed', `No ${bin} build for ${platform}`)
    const { repo, version } = pkg.source
    const zip = asset.file.endsWith('.zip')
    const archive = path.join(options.root, '.downloads', `${pkg.id}-${version}-${asset.file}`)
    try {
      await downloadPinned(
        {
          name: asset.file,
          url: `https://github.com/${repo}/releases/download/${version}/${asset.file}`,
          bytes: asset.bytes,
          sha256: asset.sha256,
        },
        archive,
        {
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          ...options.download,
          onProgress: ({ received, total }) => progress(total ? received / total : 0),
        },
      )
    } catch (err) {
      if (err instanceof DownloadError)
        throw new InstallFailure(
          err.code === 'network' || err.code === 'timeout' ? 'offline' : 'failed',
          err.message,
        )
      throw err
    }
    const target = path.join(dir, exe(bin, platform))
    if (zip) {
      // bsdtar reads zip archives too (Windows 10+ ships it as tar.exe).
      await runChecked({ command: 'tar', args: ['-xf', archive], cwd: dir }, 'Unpacking')
    } else {
      await writeFile(target, gunzipSync(await Bun.file(archive).bytes()))
    }
    if (!existsSync(target)) throw new InstallFailure('failed', `${bin} missing after unpacking`)
    await chmod(target, 0o755)
    await rm(archive, { force: true })
  }

  async function attempt(pkg: LspPackage): Promise<LspInstallOutcome> {
    const dir = finalDir(pkg)
    const work = path.join(
      options.root,
      pkg.id,
      `${STAGING}${installKey(pkg)}-${process.pid}-${staging++}`,
    )
    const progress = (fraction: number) => {
      for (const listener of listeners.get(pkg.id) ?? []) listener(fraction)
    }
    try {
      await rm(work, { recursive: true, force: true })
      await mkdir(work, { recursive: true })
      const { source } = pkg
      if (source.type === 'npm') await installNpm({ ...pkg, source }, work)
      else if (source.type === 'golang') await installGo({ ...pkg, source }, work)
      else await installRelease({ ...pkg, source }, work, progress)
      await writeFile(path.join(work, COMPLETE), `${new Date().toISOString()}\n`)
      // Another process may have finished the same install first; its copy is as good as ours.
      if (!existsSync(path.join(dir, COMPLETE))) {
        await rm(dir, { recursive: true, force: true })
        await rename(work, dir)
      }
      handedOut.add(dir)
      await pruneUnused(path.join(options.root, pkg.id), path.basename(dir), handedOut, now())
      return { ok: true, dir }
    } catch (err) {
      if (err instanceof InstallFailure)
        return { ok: false, reason: err.reason, detail: err.message }
      return {
        ok: false,
        reason: 'failed',
        detail: err instanceof Error ? err.message : String(err),
      }
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => {})
    }
  }

  function installedDir(packageId: string): string | undefined {
    const pkg = packages[packageId]
    if (!pkg) return undefined
    const dir = finalDir(pkg)
    const marker = path.join(dir, COMPLETE)
    if (!existsSync(marker)) return undefined
    // Asked for to start a server: mark it used for the other processes' pruning.
    handedOut.add(dir)
    markUsed(dir, now())
    return dir
  }

  return {
    installedDir,

    install(packageId, onProgress) {
      const pkg = packages[packageId]
      if (!pkg)
        return Promise.resolve({
          ok: false,
          reason: 'failed',
          detail: `Unknown server ${packageId}`,
        })
      const installed = installedDir(packageId)
      if (installed) return Promise.resolve({ ok: true, dir: installed })
      if (onProgress) {
        if (!listeners.has(packageId)) listeners.set(packageId, new Set())
        listeners.get(packageId)!.add(onProgress)
      }
      let pending = inflight.get(packageId)
      if (!pending) {
        pending = attempt(pkg).finally(() => {
          inflight.delete(packageId)
          listeners.delete(packageId)
        })
        inflight.set(packageId, pending)
      }
      return pending
    },
  }
}
