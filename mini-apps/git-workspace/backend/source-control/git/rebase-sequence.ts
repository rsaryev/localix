import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiError, shellQuote } from '@localixai/mini-app-sdk/backend'
import type { RebaseAction } from '../contracts'
import { firstLine, type GitRunner } from './cli'
import { withCoAuthor } from './actions'
import { readRebaseState } from './rebase-state'

/** Env that neutralizes every interactive editor git might reach for. */
export function noEditorEnv(): NodeJS.ProcessEnv {
  return { GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' }
}

/** One resolved todo row — a reword carries the path of its message file. */
export interface TodoLine {
  hash: string
  action: RebaseAction
  /** Message file for a `reword` (already written to disk); ignored otherwise. */
  msgFile?: string
}

/**
 * Render a git-rebase-todo from resolved rows (PURE — the unit-tested core).
 * `reword` becomes `pick` + an `exec git commit --amend -F <msgfile>` so the new
 * message is applied without any editor. `drop` is emitted explicitly (clearer
 * than omission and equally valid). Rows are in git's todo order: top = applied
 * first = oldest.
 */
export function buildRebaseTodo(lines: TodoLine[]): string {
  const out: string[] = []
  for (const l of lines) {
    switch (l.action) {
      case 'reword':
        out.push(`pick ${l.hash}`)
        if (l.msgFile) out.push(`exec git commit --amend -F ${shellQuote(l.msgFile)}`)
        break
      case 'pick':
      case 'squash':
      case 'fixup':
      case 'drop':
        out.push(`${l.action} ${l.hash}`)
        break
    }
  }
  return out.join('\n') + '\n'
}

/**
 * Run `git rebase -i <base>` (or `--root`) with a pre-composed todo. Writes the
 * todo + any reword message files + the sequence-editor script to a private temp
 * dir, then invokes git with the scripted editors. On a clean finish the temp dir
 * is removed; on a conflict (rebase left in progress) it is LEFT in place so a
 * later `--continue` can still read a reword's message file.
 */
export async function runSequencedRebase(
  run: GitRunner,
  cwd: string,
  baseArg: string,
  lines: Omit<TodoLine, 'msgFile'>[],
  rewordMessages: Map<string, string>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'localix-rebase-'))
  let leaveTempDir = false
  try {
    // Materialize reword message files, then the todo referencing them.
    const resolved: TodoLine[] = []
    let i = 0
    for (const l of lines) {
      if (l.action === 'reword') {
        const msg = rewordMessages.get(l.hash)
        if (msg === undefined)
          throw new ApiError(400, 'git_rebase_failed', `Missing reword message for ${l.hash}.`)
        const msgFile = join(dir, `msg-${i++}`)
        await writeFile(msgFile, withCoAuthor(msg), 'utf8')
        resolved.push({ ...l, msgFile })
      } else {
        resolved.push(l)
      }
    }

    const todoPath = join(dir, 'todo')
    await writeFile(todoPath, buildRebaseTodo(resolved), 'utf8')

    // Sequence editor: overwrite git's todo file ($1) with ours. The todo path
    // arrives via env (never the command string) so nothing is shell-interpolated.
    const seqEditor = join(dir, 'seq-editor.sh')
    await writeFile(seqEditor, '#!/bin/sh\ncat "$LOCALIX_REBASE_TODO" > "$1"\n', 'utf8')
    await chmod(seqEditor, 0o755)

    const env: NodeJS.ProcessEnv = {
      ...noEditorEnv(),
      GIT_SEQUENCE_EDITOR: seqEditor,
      LOCALIX_REBASE_TODO: todoPath,
    }
    const res = await run(['rebase', '-i', baseArg], env)
    if (!res.ok) {
      const state = await readRebaseState(run, cwd)
      const message = firstLine(res.stderr) || firstLine(res.stdout) || 'Rebase failed.'
      if (state?.rebasing) {
        leaveTempDir = true // a pending reword exec may still need its message file
        throw new ApiError(409, 'git_rebase_conflict', message)
      }
      throw new ApiError(409, 'git_rebase_failed', message)
    }
  } finally {
    if (!leaveTempDir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
