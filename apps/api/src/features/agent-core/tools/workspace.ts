import path from 'node:path'
import os from 'node:os'
import { existsSync } from 'node:fs'

import { localixHome } from '../../../lib/env'
import { isPathWithin } from '../../../lib/path-containment'

/**
 * The parts of `~/.localix` agents AUTHOR, and so read and write without an outside-workspace
 * prompt in every role: session scratch (`tmp/`), per-task and default-project workspaces
 * (`workspace/`), the user's own mini apps (`mini-apps/`, where `/mini-app create` puts them),
 * plugins (`plugins/`) and skills (`skills/`). A mini app's data (`mini-apps-data/`) is not authored
 * by the agent and is not among them.
 *
 * Not the whole of `~/.localix`. That used to be the root, and it made the database, the vault,
 * the captured login-shell environment and the backups silently writable by any agent — while
 * reading a mini app the agent had just been asked to build prompted, because readers were
 * confined to the session workspace. An authoring session asked for approval on every read of its
 * own folder. The line is the kind of content, not the directory it happens to sit in.
 */
export const AGENT_ALLOWED_ROOTS: string[] = [
  'workspace',
  'tmp',
  'mini-apps',
  'plugins',
  'skills',
].map((dir) => path.join(localixHome(), dir))

/**
 * A generic session-scoped scratch directory any tool may write/read (e.g. a tool
 * that renders from a file). UI/feature-agnostic — the path is under an agent-owned
 * allowed root so the file tools may write there regardless of the workspace.
 */
export function sessionScratchDir(sessionId: string): string {
  return path.join(sessionScratchRoot(), sessionId)
}

/** The parent of every session scratch dir — agent-written files, never user data or secrets. */
export function sessionScratchRoot(): string {
  return path.join(localixHome(), 'tmp', 'sessions')
}

/**
 * True if `candidate` resolves inside the workspace `root` (lexical check — no symlink
 * following), or inside an agent-owned allowed root. A `/` or
 * empty root means "no boundary" → always inside (safe no-op when there's no workspace).
 *
 * ROOT-INCLUSIVE (`isPathWithin`, not `isPathBelow`): the workspace directory itself is
 * "inside the workspace" — the cwd of every run is that directory, and
 * `outsideHomePathsInCommand` below asks the same question of the home dir, where a bare
 * `~` must answer yes. This file used to re-derive the rule as a local `isPathUnder`; the
 * rule now has ONE owner (`lib/path-containment.ts`), which also closes the trap that copy
 * carried: `rel.startsWith('..')` rejects a legitimately-contained file whose NAME merely
 * begins with two dots (`<root>/..gitignore`).
 */
export function isInsideWorkspace(root: string | undefined, candidate: string): boolean {
  if (!root || root === '/' || root === '') return true
  if (isPathWithin(root, candidate)) return true
  return AGENT_ALLOWED_ROOTS.some((r) => isPathWithin(r, candidate))
}

/** POSIX absolute, Windows drive-absolute, or a UNC share with a real host and share name. */
function looksLikeAbsolutePath(token: string): boolean {
  if (token.startsWith('/')) return true
  if (/^[A-Za-z]:[\\/]/.test(token)) return true
  return /^\\\\[A-Za-z0-9._-]+\\[A-Za-z0-9._$-]+/.test(token)
}

/** System roots that are safe to touch without prompting (never the user's project files). */
const SAFE_SYSTEM_PREFIXES = [
  '/usr',
  '/bin',
  '/sbin',
  '/etc',
  '/tmp',
  '/var',
  '/dev',
  '/opt',
  '/private',
  '/System',
  '/Library',
  '/Applications',
  '/proc',
  '/run',
]

/**
 * Extract absolute path tokens from a shell command that point OUTSIDE the workspace and
 * live under the user's home (i.e. real user files, not system paths). Best-effort heuristic
 * to catch escapes like `cd /Users/me/other` or `npm create vite /Users/me/other`.
 *
 * This is what raises `outsideWorkspace` on a permission card, so a form it cannot spell is
 * a control that silently does not run. It used to recognize only `~/…` and POSIX `/…`,
 * which meant that on Windows NOTHING was ever flagged: `C:\Users\me\other` does not start
 * with a slash, and `C:/Users/me/other` only ever matched from the colon onward as the
 * unrelated absolute path `/Users/me/other`, which is then not under the Windows home and
 * gets dropped. A command running inside the workspace could reference any file in the
 * user's profile without the card ever saying so. Drive-absolute and UNC tokens are
 * therefore matched too. There is no cost on POSIX — `X:\…` and `\\server\share` do not
 * occur in POSIX commands.
 *
 * `home` is injectable so the Windows shape is testable from any host; it is not a
 * behavioural seam and callers should leave it alone.
 */
export function outsideHomePathsInCommand(
  command: string,
  root: string | undefined,
  cwd?: string,
  home: string = os.homedir(),
): string[] {
  if (!root || root === '/') return []
  const found = new Set<string>()
  const base = cwd && path.isAbsolute(cwd) ? cwd : root
  const tokens = commandPathTokens(command, base, home)
  for (const token of tokens.absolute) {
    if (SAFE_SYSTEM_PREFIXES.some((p) => token === p || token.startsWith(p + '/'))) continue
    // Only flag paths under the user's home (real project files), not system locations.
    if (!isInsideWorkspace(home, token)) continue
    if (!isInsideWorkspace(root, token)) found.add(token)
  }
  for (const resolved of tokens.relative) {
    if (!isInsideWorkspace(home, resolved)) continue
    if (!isInsideWorkspace(root, resolved)) found.add(resolved)
  }
  return [...found]
}

/**
 * The path-shaped tokens of one shell command, unfiltered: absolute ones (with `~/` expanded)
 * and relative `..` escapes resolved against `base`. One tokenizer, because two questions ask
 * it — "does this leave the workspace" (above, filtered to the home dir) and "does this reach
 * the host application" (`host-root-guard.ts`, unfiltered: a packaged install lives under
 * `/Applications` or `C:\Program Files`, which the home filter would drop). A second copy of
 * the regex is a second place for a spelling to be missed.
 */
export function commandPathTokens(
  command: string,
  base: string | undefined,
  home: string = os.homedir(),
): { absolute: string[]; relative: string[] } {
  const absolute: string[] = []
  const relative: string[] = []
  // `~/…`, POSIX `/…`, Windows drive-absolute `C:\…` / `C:/…`, and UNC `\\server\share`
  // (stop at shell separators/quotes).
  const re =
    /(?:^|[\s=:"'(])(~\/[^\s"';|&)>]*|[A-Za-z]:[\\/][^\s"';|&)>]*|\\\\[^\s"';|&)>]+|\/[^\s"';|&)>]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(command)) !== null) {
    let token = m[1]
    if (token.startsWith('~/')) token = path.join(home, token.slice(2))
    // Only an ABSOLUTE token can be a path we judge. A JS string's escaped quotes (`\\\"`)
    // matched the UNC branch and, resolved against the home dir, read as a file outside the
    // workspace — one `node -e` with a regex literal in it cost a confirmation prompt.
    if (looksLikeAbsolutePath(token)) absolute.push(token)
  }
  if (!base) return { absolute, relative }
  // Catch common relative escapes in mutating shell commands: ../target, ..,
  // ./../target. This is intentionally conservative; shell parsing is too rich
  // to model precisely here, so permission prompts should err on visibility.
  const relativeRe = /(?:^|[\s=:"'(])((?:\.{1,2}\/|\.\.)(?:[^\s"';|&)>]*)?)/g
  while ((m = relativeRe.exec(command)) !== null) {
    const token = m[1]
    if (token.includes('..')) relative.push(path.resolve(base, token))
  }
  return { absolute, relative }
}

/** Whether a directory is a git checkout (a `.git` entry — dir or worktree file). */
export function isGitCheckout(root: string): boolean {
  return existsSync(path.join(root, '.git'))
}
