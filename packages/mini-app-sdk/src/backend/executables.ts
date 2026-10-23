/**
 * Find and spawn a host tool (`docker`, `git`, `gh`) the way a person's terminal would.
 *
 * THE DEFECT THIS STOPS. A packaged desktop app starts with launchd's bare PATH
 * (`/usr/bin:/bin:/usr/sbin:/sbin`). The host repairs `process.env.PATH` from the login shell after
 * boot, but under Bun a `Bun.spawn` that passes no `env` resolves its executable against the PATH
 * the process STARTED with — so `Bun.spawn(['docker', …])` threw `Executable not found in $PATH:
 * "docker"` on a machine where `/usr/local/bin/docker` was right there, and the DevOps sidebar said
 * "Docker returned an error." Every mini app spawn has to pass the CURRENT environment, and lookups
 * must read the current PATH explicitly; this module is the one place that knows how.
 *
 * It also appends the well-known install directories a GUI app's PATH tends to miss (Homebrew,
 * Docker Desktop, OrbStack, Rancher Desktop) AFTER the person's own PATH, so their PATH still wins
 * and a tool installed somewhere ordinary is found even when the login-shell probe failed.
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function wellKnownDirs(platform: NodeJS.Platform, home: string): string[] {
  if (platform === 'darwin') {
    return [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      join(home, '.docker/bin'),
      '/Applications/Docker.app/Contents/Resources/bin',
      join(home, '.orbstack/bin'),
      join(home, '.rd/bin'),
      join(home, '.local/bin'),
    ]
  }
  if (platform === 'linux') {
    return [
      '/usr/local/bin',
      '/snap/bin',
      join(home, '.local/bin'),
      '/home/linuxbrew/.linuxbrew/bin',
    ]
  }
  return []
}

export interface ToolPathOptions {
  /** The PATH to extend. Defaults to the CURRENT `process.env.PATH` (the repaired one). */
  path?: string
  platform?: NodeJS.Platform
  home?: string
  /** Existence probe, injectable for tests. */
  exists?: (dir: string) => boolean
}

/** The current PATH plus the well-known install directories that exist and are not on it yet. */
export function toolPath(options: ToolPathOptions = {}): string {
  const platform = options.platform ?? process.platform
  const sep = platform === 'win32' ? ';' : ':'
  const base = options.path ?? process.env.PATH ?? ''
  const exists = options.exists ?? existsSync
  const entries = base.split(sep).filter(Boolean)
  const seen = new Set(entries)
  for (const dir of wellKnownDirs(platform, options.home ?? homedir())) {
    if (!seen.has(dir) && exists(dir)) {
      entries.push(dir)
      seen.add(dir)
    }
  }
  return entries.join(sep)
}

/**
 * The environment to hand EVERY spawn of a host tool: the current `process.env` (never the
 * start-time snapshot Bun falls back to without one) with {@link toolPath} as PATH.
 */
export function toolEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...process.env, ...extra })) {
    if (value !== undefined) env[key] = value
  }
  env.PATH = toolPath({ path: env.PATH })
  return env
}

/** Absolute path of `name` on {@link toolPath}, or `null` when it is not installed there. */
export function resolveExecutable(name: string): string | null {
  return Bun.which(name, { PATH: toolPath() }) ?? null
}
