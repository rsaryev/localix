import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scratchGitEnv } from './scratch-git-env'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function git(args: string[], env: Record<string, string | undefined>) {
  const proc = Bun.spawn(['git', ...args], { env, stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  await proc.exited
  return stdout.trim()
}

/**
 * A repository with a linked worktree, and the environment a pre-commit hook in that worktree
 * inherits: git sets GIT_DIR to the worktree's gitdir, which points back at the shared config.
 */
async function hookFixture() {
  const root = await mkdtemp(join(tmpdir(), 'scratch-git-env-'))
  dirs.push(root)
  const repo = join(root, 'repo')
  const clean = scratchGitEnv()
  await git(['init', '--quiet', repo], clean)
  const author = ['-c', 'user.name=t', '-c', 'user.email=t@t']
  await git(['-C', repo, ...author, 'commit', '--quiet', '--allow-empty', '-m', 'root'], clean)
  await git(['-C', repo, 'worktree', 'add', '--quiet', join(root, 'wt')], clean)
  const hookEnv = { ...process.env, GIT_DIR: join(repo, '.git', 'worktrees', 'wt') }
  const bare = () => git(['-C', repo, 'config', 'core.bare'], scratchGitEnv())
  return { root, repo, hookEnv, bare }
}

describe('scratchGitEnv', () => {
  test('control: the inherited GIT_DIR makes `git init <tmp>` rewrite the committing repo', async () => {
    const { root, hookEnv, bare } = await hookFixture()
    expect(await bare()).toBe('false')
    await git(['init', '--quiet', join(root, 'scratch')], hookEnv)
    // The failure the helper exists for — if this stops holding, the helper is dead weight.
    expect(await bare()).toBe('true')
  })

  test('without the locating variables, `git init <tmp>` touches only the scratch dir', async () => {
    const { root, hookEnv, bare } = await hookFixture()
    const scratch = join(root, 'scratch')
    await git(['init', '--quiet', scratch], scratchGitEnv(hookEnv))
    expect(await bare()).toBe('false')
    expect(await git(['-C', scratch, 'rev-parse', '--git-dir'], scratchGitEnv())).toBe('.git')
  })

  test('keeps everything that does not locate a repository', () => {
    const env = scratchGitEnv({ PATH: '/bin', GIT_DIR: '/x', GIT_INDEX_FILE: '/i', HOME: '/h' })
    expect(env).toEqual({ PATH: '/bin', HOME: '/h' })
  })
})
