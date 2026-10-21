import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createGitResourceProvider,
  type ResourceGitService,
  type GitRepoProject,
} from './resource-provider'
import { createGitBackend } from './git/backend'
import { getStagedDiff, getUnstagedDiff, getBranchDiff } from './git/scope-diff'
import { gitRunner } from './git/cli'

describe('git resource provider — real git backend', () => {
  let dir: string
  let sha = ''

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sc-rrp-'))
    const run = gitRunner(dir)
    await run(['init', '-q'])
    await run(['config', 'user.email', 'test@example.com'])
    await run(['config', 'user.name', 'Test'])
    await run(['config', 'commit.gpgsign', 'false'])
    await writeFile(join(dir, 'a.txt'), 'first\n')
    await writeFile(join(dir, 'src.ts'), 'export const x = 1\n')
    await run(['add', '-A'])
    await run(['commit', '-q', '-m', 'initial commit'])
    sha = (await run(['rev-parse', '--short', 'HEAD'])).stdout.trim()
    // an uncommitted change so the status node has something to show
    await writeFile(join(dir, 'a.txt'), 'first\nsecond\n')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function realService(): ResourceGitService {
    const backend = createGitBackend()
    const projects: GitRepoProject[] = [{ id: 'PRJ-1', name: 'tmp', cwd: dir, branch: null }]
    return {
      listRepoProjects: async () => projects,
      resolveRepoCwd: async (_u, pid) => projects.find((p) => p.id === pid)?.cwd ?? null,
      listRepos: async (cwd) => [{ relpath: '', name: 'root', cwd }],
      listBranches: (cwd) => backend.listBranches(cwd),
      getStatus: (cwd) => backend.getStatus(cwd),
      getLog: (cwd, limit) => backend.getLog(cwd, limit),
      getCommitShow: (cwd, s) => backend.getCommitShow(cwd, s),
      getCommitFiles: (cwd, s) => backend.getCommitFiles(cwd, s),
      getCommitFileDiff: (cwd, s, path) => backend.getCommitFileDiff(cwd, s, path),
      getWorkingDiff: (cwd) => backend.getCommitDiff(cwd),
      getStagedDiff: (cwd) => getStagedDiff(cwd),
      getUnstagedDiff: (cwd) => getUnstagedDiff(cwd),
      getBranchDiff: (cwd, branch) => getBranchDiff(cwd, branch),
    }
  }

  test('drill repo → commit → file → diff against real git', async () => {
    const p = createGitResourceProvider(realService())
    const commits = await p.listChildren('u', 'localix://resource/git/PRJ-1/commits')
    expect(commits[0].uri).toBe(`localix://resource/git/PRJ-1/commits/${sha}`)

    const files = await p.listChildren('u', `localix://resource/git/PRJ-1/commits/${sha}`)
    expect(files.map((f) => f.label).sort()).toEqual(['a.txt', 'src.ts'])

    const patch = await p.expand('u', `localix://resource/git/PRJ-1/commits/${sha}/src.ts`)
    expect(patch.ok).toBe(true)
    expect(patch.language).toBe('diff')
    expect(patch.content).toContain('export const x = 1')

    const status = await p.expand('u', 'localix://resource/git/PRJ-1/status')
    expect(status.ok).toBe(true)
    expect(status.content).toContain('a.txt')
    expect(status.content).toContain('+second')
  })
})
