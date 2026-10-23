import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveExecutable } from '@localixai/mini-app-sdk/backend'

/**
 * Is a container engine INSTALLED here, even though the `docker` CLI could not be run?
 *
 * The CLI missing from PATH and the engine missing from the machine are different facts with
 * different ways out. Docker Desktop installs its CLI as a symlink that only exists while the app
 * has run at least once, and OrbStack/Colima put theirs in places a GUI app's PATH never sees — so
 * "docker: not found" on a Mac with Docker.app in /Applications means "start it", and telling that
 * person to install Docker sends them to download something they already have.
 *
 * Backend-only (it reads the filesystem); the pure classifier in `errors.ts` stays browser-safe.
 */
export interface InstalledEngine {
  name: string
  /** The command that starts it — pasted for the person, never run. */
  command?: string
}

export interface InstalledEngineProbe {
  platform?: NodeJS.Platform
  home?: string
  exists?: (path: string) => boolean
  which?: (name: string) => string | null
}

export function detectInstalledEngine(probe: InstalledEngineProbe = {}): InstalledEngine | null {
  const platform = probe.platform ?? process.platform
  const home = probe.home ?? homedir()
  const exists = probe.exists ?? existsSync
  const which = probe.which ?? resolveExecutable
  if (platform === 'darwin') {
    const apps: Array<[string, string, string]> = [
      ['Docker Desktop', 'Docker.app', 'open -a Docker'],
      ['OrbStack', 'OrbStack.app', 'open -a OrbStack'],
      ['Rancher Desktop', 'Rancher Desktop.app', 'open -a "Rancher Desktop"'],
    ]
    for (const [name, bundle, command] of apps) {
      if (exists(join('/Applications', bundle)) || exists(join(home, 'Applications', bundle))) {
        return { name, command }
      }
    }
  }
  if (which('colima')) return { name: 'Colima', command: 'colima start' }
  if (platform === 'linux' && which('dockerd')) {
    return { name: 'Docker Engine', command: 'sudo systemctl start docker' }
  }
  if (platform === 'win32' && exists('C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe')) {
    return { name: 'Docker Desktop' }
  }
  return null
}
