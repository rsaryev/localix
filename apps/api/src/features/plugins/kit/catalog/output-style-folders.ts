import { dirname, join, resolve } from 'node:path'

import { settingsLocations } from '@rsaryev/llx-plugin/settings'

/** Localix's own folder beside each of Claude Code's `.claude/output-styles`. */
const LOCALIX_STYLE_DIR = '.localix/output-styles'

export interface OutputStyleFolders {
  /** The project's folders, nearest the working directory first. */
  readonly project: readonly string[]
  /** The person's folders: `~/.localix/output-styles`, then Claude Code's user folder. */
  readonly user: readonly string[]
}

/** `cwd` and each of its parents, nearest first, up to the filesystem root. */
function ancestry(cwd: string): string[] {
  const chain = [resolve(cwd)]
  for (let parent = dirname(chain[0]!); parent !== chain.at(-1); parent = dirname(parent))
    chain.push(parent)
  return chain
}

/** Localix's folder in the same base as Claude Code's `<base>/.claude/output-styles`. */
const localixBeside = (claudeFolder: string): string =>
  join(dirname(dirname(claudeFolder)), LOCALIX_STYLE_DIR)

/**
 * The folders output styles are read from, as the kit lists them (`settingsLocations`, permissions.md,
 * "Where output styles, hooks, and local settings load from": "the current working directory and its
 * parents, your user directory at `~/.claude/`"), nearest first. The kit's walk goes to the
 * filesystem root; output-styles.md, "Create a custom output style", says "to the repository root".
 * The kit wins. Localix's `.localix/output-styles` goes before Claude Code's at each base, so where
 * both define a name at one level Localix's folder wins. `CLAUDE_CONFIG_DIR` is taken as written
 * (the kit's `configDirectoryOf`). A folder that is also one of the person's is theirs, not the
 * project's.
 */
export function outputStyleFolders(input: {
  homeDir: string
  cwd?: string | null
  env?: Record<string, string | undefined>
}): OutputStyleFolders {
  const home = resolve(input.homeDir)
  const configDirectory = (input.env ?? process.env).CLAUDE_CONFIG_DIR
  const cwd = input.cwd || undefined
  const locations = settingsLocations({
    primaryWorkingDirectory: cwd ?? home,
    home,
    ...(configDirectory === undefined ? {} : { configDirectory }),
    directories: cwd === undefined ? [] : ancestry(cwd),
    windows: process.platform === 'win32',
    join,
  })
  const claudeUser = locations.outputStyles.at(-1)!
  const user = [join(home, LOCALIX_STYLE_DIR), claudeUser]
  const project = locations.outputStyles
    .slice(0, -1)
    .flatMap((folder) => [localixBeside(folder), folder])
    .filter((folder) => !user.includes(folder))
  return { project, user }
}
