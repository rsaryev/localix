import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'

import { readSkillMarkdownFile } from '../agent-core/skill-file'
import { outputStyleFile, outputStyleFolders, type StyleBody } from './kit'

/**
 * The person's and the project's own output styles: Localix's `.localix/output-styles` and Claude
 * Code's own — `~/.claude/output-styles` (or `$CLAUDE_CONFIG_DIR/output-styles`) and a project's
 * `.claude/output-styles` — so the styles a person wrote for Claude Code are offered here too. Each
 * is a Markdown file with optional frontmatter, the file name being the name unless `name` sets one.
 *
 * Project styles load from every such folder from the working directory up (the kit's folders,
 * `outputStyleFolders`); where two define one name, the one nearest the working directory wins, and
 * at one level Localix's folder wins over Claude Code's.
 * Read when a chat runs or lists its styles, so an edit applies from the next message.
 */

/** Far beyond a style, and bounds what one folder can make the run read. */
const MAX_STYLES_PER_DIR = 64

/** The styles in one folder, sorted by file name; a file that cannot be read is skipped. */
export async function readOutputStyleDir(dir: string): Promise<StyleBody[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const files = entries
    .filter((entry) => entry.isFile() && extname(entry.name) === '.md')
    .map((entry) => entry.name)
    .sort()
    .slice(0, MAX_STYLES_PER_DIR)
  const styles: StyleBody[] = []
  for (const name of files) {
    const raw = await readSkillMarkdownFile(join(dir, name)).catch(() => null)
    if (raw === null) continue
    const style = outputStyleFile(join(dir, name), raw)
    if (!styles.some((found) => found.name === style.name)) styles.push(style)
  }
  return styles
}

/** The styles of `folders` in order, the first of a name winning. */
async function firstByName(folders: readonly string[]): Promise<StyleBody[]> {
  const out = new Map<string, StyleBody>()
  for (const folder of folders)
    for (const style of await readOutputStyleDir(folder))
      if (!out.has(style.name)) out.set(style.name, style)
  return [...out.values()]
}

/** The person's styles and the project's, each resolved nearest first to one per name. */
export async function readLocalOutputStyles(input: {
  homeDir: string
  cwd?: string | null
  env?: Record<string, string | undefined>
}): Promise<{ user: StyleBody[]; project: StyleBody[] }> {
  const folders = outputStyleFolders(input)
  return { user: await firstByName(folders.user), project: await firstByName(folders.project) }
}
