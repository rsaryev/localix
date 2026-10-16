import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

import type { Logger } from 'pino'

import {
  createShellCommandService,
  type ShellCommandService,
} from '../features/shell-command/service'

type PathExists = (path: string) => boolean

const APPIMAGE_MOUNT_SEGMENT = /(^|\/)\.mount_[^/]+(?:\/|$)/

/** AppImage contents disappear with their temporary mount, so they cannot back a durable launcher. */
export function hasPersistentShellCommandRuntime(
  platform: NodeJS.Platform,
  cliEntry: string,
  bunPath: string,
): boolean {
  if (platform !== 'linux') return true
  return !APPIMAGE_MOUNT_SEGMENT.test(cliEntry) && !APPIMAGE_MOUNT_SEGMENT.test(bunPath)
}

/** Remove only launchers left by legacy AppImage builds; durable package launchers are preserved. */
export async function removeStaleAppImageLauncher(
  service: Pick<ShellCommandService, 'status' | 'uninstall'>,
  platform: NodeJS.Platform,
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
): Promise<boolean> {
  if (platform !== 'linux') return false
  const status = await service.status()
  const launcher = await read(status.targetPath).catch(() => '')
  if (!APPIMAGE_MOUNT_SEGMENT.test(launcher)) return false
  await service.uninstall()
  return true
}

/** Resolve the staged desktop shim first, then the two supported source layouts. */
export function resolveCliEntry(
  explicit: string | undefined,
  cwd: string,
  exists: PathExists = existsSync,
): string | null {
  if (explicit && exists(explicit)) return explicit
  const candidates = [
    resolve(cwd, 'packages/cli/bin/localix.mjs'),
    resolve(cwd, '../../packages/cli/bin/localix.mjs'),
  ]
  return candidates.find((path) => exists(path)) ?? null
}

/**
 * Compose the `localix` shell-command installer.
 *
 * Path discovery and desktop-only auto-install policy live together here so the
 * main bootstrap remains a service graph rather than accumulating host-specific
 * filesystem decisions.
 */
export function createBootShellCommandService(args: {
  cliEntryFromEnv?: string
  logger: Pick<Logger, 'warn'>
}) {
  const cliEntry = resolveCliEntry(args.cliEntryFromEnv, process.cwd())
  const available =
    cliEntry != null &&
    hasPersistentShellCommandRuntime(process.platform, cliEntry, process.execPath)

  const service = createShellCommandService({
    platform:
      process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux',
    home: homedir(),
    cliEntry: cliEntry ?? '',
    bunPath: process.execPath,
    pathEnv: process.env.PATH ?? '',
    available,
  })

  // Only Desktop supplies this value. Refresh its staged launcher
  // opportunistically; plain web/dev runs never touch the user's PATH.
  if (args.cliEntryFromEnv) {
    const refresh = available
      ? service.status().then((status) => (status.state === 'installed' ? null : service.install()))
      : removeStaleAppImageLauncher(service, process.platform)
    refresh.catch((error) =>
      args.logger.warn({ event: 'shell_command.autoinstall_error', error: String(error) }),
    )
  }

  return service
}
