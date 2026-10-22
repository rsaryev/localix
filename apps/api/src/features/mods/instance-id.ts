import { createHash } from 'node:crypto'

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
