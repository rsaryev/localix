import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import ignore, { type Ignore } from 'ignore'

/**
 * The ignore rules git applies BESIDES the `.gitignore` files: `$GIT_DIR/info/exclude` and the
 * file `core.excludesFile` names (default `$XDG_CONFIG_HOME/git/ignore`).
 *
 * The walk read only `.gitignore`, so a file a person had excluded locally — scratch notes, a
 * generated client kept out of the repository through `info/exclude` or a global ignore — was
 * mapped as project code while every git tool in the app treated it as absent. Both files are
 * relative to the repository's top level, which is not always the project's root (a project
 * opened on a package of a monorepo), so each matcher carries the project's path inside the repo.
 *
 * No git process: discovery deliberately does not require git, so the repository is found by
 * looking for `.git` upward and the setting is read from the config files directly — the plain
 * `excludesFile = <path>` form under `[core]`; `include` directives are not followed.
 */
export interface RepoExcludes {
  /** The project root's path inside the repository, POSIX, '' at the top level. */
  prefix: string
  matcher: Ignore
}

export interface ExcludeEnvironment {
  home?: string
  xdgConfigHome?: string
}

export async function readRepoExcludes(
  root: string,
  env: ExcludeEnvironment = {},
): Promise<RepoExcludes | null> {
  const repo = await findRepository(root)
  if (!repo) return null
  const home = env.home ?? homedir()
  const xdg = env.xdgConfigHome ?? process.env.XDG_CONFIG_HOME ?? join(home, '.config')
  const configured =
    (await excludesFileSetting(join(repo.commonDir, 'config'))) ??
    (await excludesFileSetting(join(home, '.gitconfig'))) ??
    (await excludesFileSetting(join(xdg, 'git', 'config')))
  const globalFile = configured
    ? expandHome(configured, home, repo.top)
    : join(xdg, 'git', 'ignore')
  // Lowest precedence first, as git reads them.
  const texts = await Promise.all([
    readText(globalFile),
    readText(join(repo.commonDir, 'info', 'exclude')),
  ])
  const rules = texts.filter((text): text is string => text !== null)
  if (rules.length === 0) return null
  const prefix = relative(repo.top, root).split(sep).join('/')
  return { prefix, matcher: ignore().add(rules.join('\n')) }
}

/** Whether the repository-level rules exclude a project-relative path. */
export function excludedByRepo(
  excludes: RepoExcludes | null,
  path: string,
  directory: boolean,
): boolean {
  if (!excludes) return false
  const inRepo = excludes.prefix ? `${excludes.prefix}/${path}` : path
  return excludes.matcher.ignores(directory ? `${inRepo}/` : inRepo)
}

/**
 * The working tree's top level and the directory holding `info/` and `config`. A linked worktree's
 * `.git` is a FILE pointing at `<main>/.git/worktrees/<name>`, whose `commondir` names the shared
 * directory where `info/exclude` actually lives.
 */
async function findRepository(root: string): Promise<{ top: string; commonDir: string } | null> {
  let dir = resolve(root)
  for (;;) {
    const dotGit = join(dir, '.git')
    const info = await stat(dotGit).catch(() => null)
    if (info?.isDirectory()) return { top: dir, commonDir: dotGit }
    if (info?.isFile()) {
      const pointer = (await readText(dotGit))?.match(/^gitdir:\s*(.+)$/m)?.[1]?.trim()
      if (!pointer) return null
      const gitDir = isAbsolute(pointer) ? pointer : resolve(dir, pointer)
      const common = (await readText(join(gitDir, 'commondir')))?.trim()
      return { top: dir, commonDir: common ? resolve(gitDir, common) : gitDir }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

async function excludesFileSetting(configPath: string): Promise<string | null> {
  const text = await readText(configPath)
  if (text === null) return null
  let inCore = false
  let found: string | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const section = line.match(/^\[\s*([^\]\s"]+)/)
    if (section) {
      inCore = section[1]!.toLowerCase() === 'core'
      continue
    }
    if (!inCore) continue
    const setting = line.match(/^excludesfile\s*=\s*(.*)$/i)
    // The last assignment wins, as in git.
    if (setting) found = unquote(setting[1]!.replace(/\s+[#;].*$/, '').trim())
  }
  return found || null
}

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value
}

function expandHome(path: string, home: string, top: string): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return join(home, path.slice(2))
  return isAbsolute(path) ? path : resolve(top, path)
}

function readText(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null)
}
