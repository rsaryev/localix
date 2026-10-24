import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join, parse, resolve } from 'node:path'

import { outputStyleOf, type OutputStyle } from '@localixai/claude-plugin'

import { claudeConfigDir } from '../cc-settings/config-dir'
import { parseMarkdownFrontmatter } from '../agent-core/frontmatter-yaml'
import { readSkillMarkdownFile } from '../agent-core/skill-file'

/**
 * The person's and the project's own output styles: Localix's `.localix/output-styles` and Claude
 * Code's own — `~/.claude/output-styles` (or `$CLAUDE_CONFIG_DIR/output-styles`) and a project's
 * `.claude/output-styles` — so the styles a person wrote for Claude Code are offered here too. Each
 * is a Markdown file with optional frontmatter, the file name being the name unless `name` sets one.
 *
 * Project styles load from every such folder between the working directory and the repository
 * root; where two define one name, the one nearest the working directory wins, and at one level
 * Localix's folder wins over Claude Code's.
 * Read when a chat runs or lists its styles, so an edit applies from the next message.
 */

/** Far beyond a style, and bounds what one folder can make the run read. */
const MAX_STYLES_PER_DIR = 64
const MAX_ANCESTRY = 32
const STYLE_DIR = join('.localix', 'output-styles')
const CLAUDE_STYLE_DIR = join('.claude', 'output-styles')

/** The styles in one folder, sorted by file name; a file that cannot be read is skipped. */
export async function readOutputStyleDir(dir: string): Promise<OutputStyle[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const files = entries
    .filter((entry) => entry.isFile() && extname(entry.name) === '.md')
    .map((entry) => entry.name)
    .sort()
    .slice(0, MAX_STYLES_PER_DIR)
  const styles: OutputStyle[] = []
  for (const name of files) {
    const raw = await readSkillMarkdownFile(join(dir, name)).catch(() => null)
    if (raw === null) continue
    // A frontmatter that does not parse still loads the style under its file name, as in Claude
    // Code: the YAML reader returns no fields for it.
    const { fields, body } = parseMarkdownFrontmatter(raw)
    const style = outputStyleOf(basename(name, '.md'), fields, body)
    if (!styles.some((found) => found.name === style.name)) styles.push(style)
  }
  return styles
}

/** One style per name, the later list's winning. */
function byName(styles: readonly OutputStyle[]): OutputStyle[] {
  const out = new Map<string, OutputStyle>()
  for (const style of styles) out.set(style.name, style)
  return [...out.values()]
}

const exists = (path: string) =>
  fs.stat(path).then(
    () => true,
    () => false,
  )

/** The working directory and its parents up to the repository root; only itself outside one. */
async function projectChain(cwd: string, home: string): Promise<string[]> {
  const start = resolve(cwd)
  const chain: string[] = []
  let current = start
  for (let depth = 0; depth < MAX_ANCESTRY; depth++) {
    if (current === home) break
    chain.push(current)
    if (await exists(join(current, '.git'))) return chain
    const parent = dirname(current)
    if (parent === current || current === parse(current).root) break
    current = parent
  }
  // No repository: the working directory alone, unless it is the home the person's styles are in.
  return start === home ? [] : [start]
}

/** The person's styles and the project's, nearest first resolved to one per name. */
export async function readLocalOutputStyles(input: {
  homeDir: string
  cwd?: string | null
  env?: Record<string, string | undefined>
}): Promise<{ user: OutputStyle[]; project: OutputStyle[] }> {
  const home = resolve(input.homeDir)
  const user = byName([
    ...(await readOutputStyleDir(join(claudeConfigDir(home, input.env), 'output-styles'))),
    ...(await readOutputStyleDir(join(home, STYLE_DIR))),
  ])
  if (!input.cwd || input.cwd === '/') return { user, project: [] }
  const chain = await projectChain(input.cwd, home)
  const project = new Map<string, OutputStyle>()
  // Root first, so a nearer folder's style replaces a farther one's of the same name.
  for (const dir of chain.reverse())
    for (const folder of [CLAUDE_STYLE_DIR, STYLE_DIR])
      for (const style of await readOutputStyleDir(join(dir, folder)))
        project.set(style.name, style)
  return { user, project: [...project.values()] }
}
