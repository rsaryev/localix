import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { localixHome } from '../../../../lib/env'
import { childEnvNonInteractive } from '../../../../lib/login-shell-env'
import { isPathWithin, resolveWithin } from '../../../../lib/path-containment'

/**
 * `agent(prompt, { isolation: 'worktree' })`: the agent works in a fresh git worktree of the
 * chat's repository, as Claude Code runs it, so agents that edit files in parallel do not
 * overwrite each other.
 *
 * The worktree is checked out at the repository's HEAD on a branch of its own, under Localix's
 * worktree root — never inside the project, where it would show as untracked files — and the
 * agent's folder in it mirrors where the chat works in the repository. When the agent ends, a
 * worktree it left unchanged (a clean status on the commit it started from) is removed with its
 * branch; one with changes is kept, and the run says where, as Claude Code keeps it. A run with
 * a WorktreeCreate hook has the hook make it instead, and keeps it (`hook-worktree.ts`).
 */

const GIT_TIMEOUT_MS = 60_000

/** Variables that point git at another repository (a hook exports them); each call names its own. */
const REPO_LOCATION_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
]

/** Run git in `cwd` and answer its trimmed standard output; throws on a non-zero exit. */
export type GitRunner = (cwd: string, args: string[]) => Promise<string>

const execFileAsync = promisify(execFile)

export function createGitRunner(env: NodeJS.ProcessEnv = childEnvNonInteractive()): GitRunner {
  const clean = { ...env }
  for (const key of REPO_LOCATION_VARS) delete clean[key]
  return async (cwd, args) => {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
      env: clean,
      timeout: GIT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      windowsHide: true,
    })
    return String(stdout).trim()
  }
}

/** Where every workflow agent's worktree lives; a child's `workingDir` is honoured only here. */
export function workflowWorktreesRoot(): string {
  return path.join(localixHome(), 'worktrees')
}

/** Is `dir` a folder this module could have made? (`chat/session-cwd.ts` asks before using one.) */
export function isWorkflowWorktreeDir(dir: string, root = workflowWorktreesRoot()): boolean {
  return path.isAbsolute(dir) && isPathWithin(root, dir) && path.resolve(dir) !== path.resolve(root)
}

export interface AgentWorktree {
  /** The worktree's top. */
  dir: string
  /** Where the agent works: the chat's folder, mirrored inside the worktree. */
  workingDir: string
  /** Absent for a worktree a WorktreeCreate hook made: Localix knows only its path. */
  branch?: string
  /** A WorktreeCreate hook made it (`hook-worktree.ts`); it is always kept, as in Claude Code. */
  byHook?: true
  /** Remove it when the agent changed nothing; `kept` says it stays, with changes. */
  finish(): Promise<{ kept: boolean }>
}

export interface CreateWorktreeInput {
  /** The chat's working folder; its repository is the one checked out. */
  cwd: string
  /** A name unique to this agent: `<runId>-<ordinal>`. */
  name: string
  /** The folder of the conversation it belongs to, under the worktree root. */
  group: string
  root?: string
  git?: GitRunner
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export async function createAgentWorktree(input: CreateWorktreeInput): Promise<AgentWorktree> {
  const git = input.git ?? createGitRunner()
  const root = input.root ?? workflowWorktreesRoot()
  if (!SAFE_SEGMENT.test(input.group) || !SAFE_SEGMENT.test(input.name))
    throw new Error('isolation: a worktree name must be a plain folder name')
  const top = await git(input.cwd, ['rev-parse', '--show-toplevel']).catch(() => '')
  if (!top) throw new Error("isolation: 'worktree' needs the chat's folder to be a git repository")
  const base = await git(top, ['rev-parse', '--verify', 'HEAD']).catch(() => '')
  if (!base) throw new Error("isolation: 'worktree' needs a repository with at least one commit")
  const dir = resolveWithin(root, path.join(input.group, input.name))
  if (!dir) throw new Error('isolation: the worktree would leave the worktree root')
  const realTop = await realpath(top).catch(() => top)
  const realCwd = await realpath(input.cwd).catch(() => input.cwd)
  const workingDir = isPathWithin(realTop, realCwd)
    ? path.join(dir, path.relative(realTop, realCwd))
    : dir
  const branch = `localix/workflow/${input.name}`
  await git(top, ['worktree', 'add', '--quiet', '-b', branch, dir, base])
  return {
    dir,
    workingDir,
    branch,
    async finish() {
      const status = await git(dir, ['status', '--porcelain']).catch(() => null)
      const head = await git(dir, ['rev-parse', 'HEAD']).catch(() => null)
      if (status !== '' || head !== base) return { kept: true }
      await git(top, ['worktree', 'remove', '--force', dir])
      await git(top, ['branch', '-D', branch]).catch(() => '')
      return { kept: false }
    },
  }
}
