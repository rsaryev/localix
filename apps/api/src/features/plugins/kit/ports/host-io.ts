import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Clock, Environment, Locations, ScratchFiles } from '@rsaryev/llx-plugin'
import { pluginDataId } from '@rsaryev/llx-plugin/loading'

/**
 * The small machine ports: time, the environment, where things are, and a scratch folder. Each is
 * the plain effect; the kit owns what it means.
 */

/** The platform paths and commands are read for: WSL counts as `posix`. */
export const hostPlatform = (): 'posix' | 'windows' =>
  process.platform === 'win32' ? 'windows' : 'posix'

/** The real clock. A timer never holds the process open. */
export const systemClock: Clock = {
  now: () => Date.now(),
  setTimer(fire, ms) {
    const timer = setTimeout(fire, ms)
    timer.unref?.()
    return () => clearTimeout(timer)
  },
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason)
      const stop = () => {
        clearTimeout(timer)
        reject(signal?.reason)
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', stop)
        resolve()
      }, ms)
      signal?.addEventListener('abort', stop, { once: true })
    }),
}

/** The environment a process gets (`childEnv`: the login shell's over Localix's), read each call. */
export function processEnvironment(source: () => NodeJS.ProcessEnv): Environment {
  const strings = (): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const [name, value] of Object.entries(source()))
      if (typeof value === 'string') out[name] = value
    return out
  }
  return { get: (name) => strings()[name], snapshot: strings }
}

export interface HostLocationsDeps {
  readonly homeDir: string
  /** The session's project folder. */
  projectDir(): string
  /** The folder a plugin was loaded from, by the id Localix keys it by. */
  pluginRoot(pluginId: string): string
}

/**
 * `${CLAUDE_PLUGIN_DATA}` of the plugin `pluginId` (`name@marketplace`, or the bare name of a plugin
 * from no marketplace): Localix keeps it at `~/.localix/plugin-data/<id>` where Claude Code keeps
 * `~/.claude/plugins/data/<id>`, `<id>` the kit's `pluginDataId`.
 */
export const pluginDataDir = (pluginId: string, home: string): string =>
  join(home, '.localix', 'plugin-data', pluginDataId(pluginId))

/** `CLAUDE_PLUGIN_DATA` is Localix's `~/.localix/plugin-data/<id>`, created when first asked. */
export function hostLocations(deps: HostLocationsDeps): Locations {
  return {
    homeDir: () => deps.homeDir,
    projectDir: () => deps.projectDir(),
    pluginRoot: (pluginId) => deps.pluginRoot(pluginId),
    async pluginData(pluginId) {
      const dir = pluginDataDir(pluginId, deps.homeDir)
      await fs.mkdir(dir, { recursive: true })
      return dir
    },
    joinPath: (base, relativePath) => join(base, ...relativePath.split('/')),
    async existingDirectory(candidates) {
      for (const candidate of candidates) {
        const info = await fs.stat(candidate).catch(() => undefined)
        if (info?.isDirectory()) return candidate
      }
      return undefined
    },
  }
}

/** Spilled text goes to `<dir>/<n>-<name>`: a fresh file per write, the name kept readable. */
export function scratchFolder(dir: () => string): ScratchFiles {
  let count = 0
  return {
    async write(name, content) {
      const folder = dir()
      await fs.mkdir(folder, { recursive: true })
      const file = join(folder, `${Date.now()}-${++count}-${name.replace(/[^\w.-]/g, '-')}`)
      await fs.writeFile(file, content)
      return file
    },
  }
}
