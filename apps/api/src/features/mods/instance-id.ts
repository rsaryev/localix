import { createHash } from 'node:crypto'

import type { ModVm } from './isolation/mod-vm'

/**
 * A mod runs once per project, as a Claude Code session runs in one directory: an instance is a
 * plugin's mod in one working directory, named `<plugin>~<hash of the directory>`. Plugin names
 * never hold `~`, so the plugin reads back off the id.
 */
export const instanceIdOf = (plugin: string, cwd: string) =>
  `${plugin}~${createHash('sha256').update(cwd).digest('hex').slice(0, 10)}`

export const pluginOfInstance = (id: string) => {
  const at = id.lastIndexOf('~')
  return at < 0 ? id : id.slice(0, at)
}

/** A running instance: one plugin's mod in one working directory. */
export interface ModInstance {
  plugin: string
  cwd: string
  usedAt: number
  dispose(): void
  vm?: ModVm
}

/** Projects a plugin's mod runs in at once; the least recently used beyond them stops. */
export const INSTANCES_PER_PLUGIN = 8

/** Why the mods running in a project refused one more (`plugin.register`). */
export class ModRefusedError extends Error {}
