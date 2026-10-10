import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RebaseState } from '../contracts'
import type { GitRunner } from './cli'
import { gitPathResolver } from './git-paths'

async function readIntFile(path: string): Promise<number | undefined> {
  try {
    const n = Number.parseInt((await readFile(path, 'utf8')).trim(), 10)
    return Number.isFinite(n) ? n : undefined
  } catch {
    return undefined
  }
}

/**
 * Read the in-progress rebase state, or `undefined` when none is underway.
 * Detected by the presence of git's `rebase-merge`/`rebase-apply` dir; step
 * counts (`msgnum`/`end`) and `onto` are best-effort reads.
 *
 * Pass `gitDir` (the absolute per-worktree `.git` dir) when the caller already
 * has it — the whole check then costs two `existsSync` calls and no git spawn,
 * which is what makes an idle status poll cheap.
 */
export async function readRebaseState(
  run: GitRunner,
  cwd: string,
  gitDir?: string,
): Promise<RebaseState | undefined> {
  // `gitDir` (already known by the status read) turns both lookups into joins.
  const gitPath = gitPathResolver(run, cwd, gitDir)
  const [mergeDir, applyDir] = await Promise.all([gitPath('rebase-merge'), gitPath('rebase-apply')])
  const dir =
    mergeDir && existsSync(mergeDir) ? mergeDir : applyDir && existsSync(applyDir) ? applyDir : null
  if (!dir) return undefined
  const [step, total] = await Promise.all([
    readIntFile(join(dir, 'msgnum')),
    readIntFile(join(dir, 'end')),
  ])
  let onto: string | undefined
  try {
    onto = (await readFile(join(dir, 'onto'), 'utf8')).trim().slice(0, 12) || undefined
  } catch {
    /* best-effort */
  }
  return {
    rebasing: true,
    ...(step !== undefined ? { step } : {}),
    ...(total !== undefined ? { total } : {}),
    ...(onto ? { onto } : {}),
  }
}
