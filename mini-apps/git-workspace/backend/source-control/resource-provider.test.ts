import { describe, expect, test } from 'bun:test'
import {
  createGitResourceProvider,
  type ResourceGitService,
  type GitRepoProject,
} from './resource-provider'
import type { FileDiff, RepoBranch, RepoCommit, RepoStatus } from './contracts'

const CWD = '/repo'

function fakeService(over: Partial<ResourceGitService> = {}): ResourceGitService {
  const projects: GitRepoProject[] = [{ id: 'PRJ-1', name: 'localix', cwd: CWD, branch: 'main' }]
  const branches: RepoBranch[] = [
    {
      name: 'main',
      current: true,
      upstream: 'origin/main',
      updatedAt: '2 hours ago',
      ahead: 0,
      behind: 0,
    },
    { name: 'feature/x', current: false, updatedAt: '3 days ago', ahead: 0, behind: 0 },
  ]
  const status: RepoStatus = {
    root: CWD,
    branch: 'main',
    detached: false,
    upstream: 'origin/main',
    ahead: 1,
    behind: 2,
    files: [
      {
        path: 'a.txt',
        status: 'modified',
        staged: false,
        unstaged: true,
        insertions: 3,
        deletions: 1,
      },
    ],
    stats: { files: 1, insertions: 3, deletions: 1 },
  }
  const log: RepoCommit[] = [
    {
      hash: 'aaaaaaaa1111',
      shortHash: 'aaaaaaa',
      subject: 'do a thing',
      author: 'Ada',
      relativeDate: '1 hour ago',
    },
  ]
  return {
    listRepoProjects: async () => projects,
    resolveRepoCwd: async (_u, pid) => projects.find((p) => p.id === pid)?.cwd ?? null,
    listRepos: async (cwd) => [{ relpath: '', name: 'root', cwd }],
    listBranches: async () => branches,
    getStatus: async () => status,
    getLog: async () => log,
    getCommitShow: async (): Promise<FileDiff> => ({
      path: 'aaaaaaa',
      diff: 'diff --git a/a.txt b/a.txt\n+second\n',
      binary: false,
    }),
    getCommitFiles: async () => ['a.txt', 'src/b.ts'],
    getCommitFileDiff: async (_c, _s, path) => `diff --git a/${path} b/${path}\n+x\n`,
    getWorkingDiff: async () => ({
      diff: 'diff --git a/a.txt b/a.txt\n+wip\n',
      stat: '',
      staged: false,
    }),
    getStagedDiff: async () => ({
      diff: 'diff --git a/a.txt b/a.txt\n+staged\n',
      truncated: false,
    }),
    getUnstagedDiff: async () => ({
      diff: 'diff --git a/a.txt b/a.txt\n+unstaged\n',
      truncated: false,
    }),
    getBranchDiff: async (_c, branch) => ({
      base: 'origin/main',
      diff: `diff --git a/${branch}.txt b/${branch}.txt\n+branch\n`,
      truncated: false,
    }),
    ...over,
  }
}

describe('git resource provider — listChildren level dispatch', () => {
  const p = createGitResourceProvider(fakeService())

  test('roots are the user git repos', async () => {
    const roots = await p.listChildren('u', null)
    expect(roots).toEqual([
      {
        uri: 'localix://resource/git/PRJ-1',
        label: 'localix',
        detail: 'main',
        hasChildren: true,
        icon: 'repo',
        actions: [{ id: 'link', label: 'Link this repository', kind: 'link' }],
      },
    ])
  })

  test('repo root lists branches/commits + working/staged/unstaged scope leaves', async () => {
    const nodes = await p.listChildren('u', 'localix://resource/git/PRJ-1')
    expect(nodes.map((n) => n.uri)).toEqual([
      'localix://resource/git/PRJ-1/branches',
      'localix://resource/git/PRJ-1/commits',
      'localix://resource/git/PRJ-1/status',
      'localix://resource/git/PRJ-1/staged',
      'localix://resource/git/PRJ-1/unstaged',
    ])
    expect(nodes.map((n) => n.icon)).toEqual([
      'git-branch',
      'history',
      'file-diff',
      'file-diff',
      'file-diff',
    ])
    // status/staged/unstaged are reviewable leaves (no children).
    expect(nodes.slice(2).every((n) => !n.hasChildren)).toBe(true)
  })

  test('branches folder lists branch leaves (slash names preserved)', async () => {
    const nodes = await p.listChildren('u', 'localix://resource/git/PRJ-1/branches')
    expect(nodes.map((n) => n.uri)).toEqual([
      'localix://resource/git/PRJ-1/branches/main',
      'localix://resource/git/PRJ-1/branches/feature/x',
    ])
    expect(nodes.every((n) => !n.hasChildren && n.icon === 'git-branch')).toBe(true)
    expect(nodes[0].detail).toContain('current')
  })

  test('commits folder lists commit folders keyed by short hash', async () => {
    const nodes = await p.listChildren('u', 'localix://resource/git/PRJ-1/commits')
    expect(nodes[0].uri).toBe('localix://resource/git/PRJ-1/commits/aaaaaaa')
    expect(nodes[0].hasChildren).toBe(true)
    expect(nodes[0].icon).toBe('git-commit')
  })

  test('a typed query searches PAST the 50-commit cap (filter first, then page)', async () => {
    // 200 commits: the target lives at index 180 — beyond the capped first page.
    const log: RepoCommit[] = Array.from({ length: 200 }, (_, i) => ({
      hash: `hash-${i}-00000000`,
      shortHash: `hash-${i}`,
      subject: i === 180 ? 'fix the flux capacitor' : `commit ${i}`,
      author: 'Ada',
      relativeDate: 'now',
    }))
    const svc = fakeService({ getLog: async (_cwd, limit) => log.slice(0, limit) })
    const prov = createGitResourceProvider(svc)
    // No query → capped page, target absent.
    const page = await prov.listChildren('u', 'localix://resource/git/PRJ-1/commits')
    expect(page).toHaveLength(50)
    expect(page.some((n) => n.label.includes('flux'))).toBe(false)
    // Query → deep search reaches it (by subject AND by sha prefix).
    const bySubject = await prov.listChildren('u', 'localix://resource/git/PRJ-1/commits', 'flux')
    expect(bySubject.map((n) => n.label)).toEqual(['fix the flux capacitor'])
    const bySha = await prov.listChildren('u', 'localix://resource/git/PRJ-1/commits', 'hash-180')
    expect(bySha.map((n) => n.label)).toEqual(['fix the flux capacitor'])
  })

  test('a query matching MORE than the page states the truncation as a notice row', async () => {
    const log: RepoCommit[] = Array.from({ length: 200 }, (_, i) => ({
      hash: `hash-${i}-00000000`,
      shortHash: `hash-${i}`,
      subject: `common subject ${i}`,
      author: 'Ada',
      relativeDate: 'now',
    }))
    const svc = fakeService({ getLog: async (_cwd, limit) => log.slice(0, limit) })
    const prov = createGitResourceProvider(svc)
    const page = await prov.listChildren('u', 'localix://resource/git/PRJ-1/commits', 'common')
    const commits = page.filter((n) => !n.notice)
    const notice = page.find((n) => n.notice)
    expect(commits).toHaveLength(50)
    expect(notice?.label).toContain('Showing 50 of 200')
    // A notice is pure information: never drillable, keyed off the parent uri.
    expect(notice?.hasChildren).toBe(false)
  })

  test('a commit is a drillable CONTAINER that is ALSO linkable (declares a link action)', async () => {
    // Regression for the reported dead-end: a commit has file children (drill) but
    // must be linkable as a whole from the top of its file level, not only via the
    // hidden `→` gesture — so it declares an explicit link action.
    const nodes = await p.listChildren('u', 'localix://resource/git/PRJ-1/commits')
    expect(nodes[0].hasChildren).toBe(true)
    expect(nodes[0].actions).toEqual([{ id: 'link', label: 'Link this commit', kind: 'link' }])
  })

  test('repo roots declare a link action (nicer verb than the default)', async () => {
    const roots = await p.listChildren('u', null)
    expect(roots[0].actions).toEqual([{ id: 'link', label: 'Link this repository', kind: 'link' }])
  })

  test('commit folder lists its files as leaves (basename label, dir detail)', async () => {
    const nodes = await p.listChildren('u', 'localix://resource/git/PRJ-1/commits/aaaaaaa')
    expect(nodes).toEqual([
      {
        uri: 'localix://resource/git/PRJ-1/commits/aaaaaaa/a.txt',
        label: 'a.txt',
        detail: undefined,
        hasChildren: false,
        icon: 'file',
      },
      {
        uri: 'localix://resource/git/PRJ-1/commits/aaaaaaa/src/b.ts',
        label: 'b.ts',
        detail: 'src',
        hasChildren: false,
        icon: 'file',
      },
    ])
  })

  test('unknown / non-git project id yields no children', async () => {
    expect(await p.listChildren('u', 'localix://resource/git/NOPE')).toEqual([])
    expect(await p.listChildren('u', 'db://x')).toEqual([])
  })
})

describe('git resource provider — expand level dispatch', () => {
  const p = createGitResourceProvider(fakeService())

  test('repo root expands to a summary (no remote url)', async () => {
    const r = await p.expand('u', 'localix://resource/git/PRJ-1')
    expect(r.ok).toBe(true)
    expect(r.content).toContain('branch main')
    expect(r.content).toContain('Ahead 1, behind 2')
    expect(r.content).toContain('aaaaaaa do a thing')
    expect(r.content).not.toContain('http')
  })

  test('branch leaf expands to a summary PLUS its vs-base diff', async () => {
    const r = await p.expand('u', 'localix://resource/git/PRJ-1/branches/feature/x')
    expect(r.ok).toBe(true)
    expect(r.content).toContain('Branch "feature/x"')
    expect(r.content).toContain('Diff vs base (origin/main)')
    expect(r.content).toContain('+branch')
  })

  test('unknown branch → error', async () => {
    const r = await p.expand('u', 'localix://resource/git/PRJ-1/branches/ghost')
    expect(r.ok).toBe(false)
  })

  test('staged leaf expands to the staged diff', async () => {
    const r = await p.expand('u', 'localix://resource/git/PRJ-1/staged')
    expect(r.ok).toBe(true)
    expect(r.content).toContain('Staged changes')
    expect(r.content).toContain('+staged')
  })

  test('an overflowing staged set says it is partial instead of reading as whole (or empty)', async () => {
    const big = createGitResourceProvider(
      fakeService({
        getStagedDiff: async () => ({ diff: 'diff --git a/a b/a\n+kept\n', truncated: true }),
      }),
    )
    const r = await big.expand('u', 'localix://resource/git/PRJ-1/staged')
    expect(r.content).toContain('+kept')
    expect(r.content).toContain('leading files only')
    expect(r.content).not.toContain('Nothing staged')
  })

  test('unstaged leaf expands to the unstaged diff', async () => {
    const r = await p.expand('u', 'localix://resource/git/PRJ-1/unstaged')
    expect(r.ok).toBe(true)
    expect(r.content).toContain('Unstaged changes')
    expect(r.content).toContain('+unstaged')
  })

  test('commit folder expands to the full patch as a diff', async () => {
    const r = await p.expand('u', 'localix://resource/git/PRJ-1/commits/aaaaaaa')
    expect(r.ok).toBe(true)
    expect(r.language).toBe('diff')
    expect(r.content).toContain('do a thing')
    expect(r.content).toContain('+second')
  })

  test('commit file leaf expands to the single-file diff', async () => {
    const r = await p.expand('u', 'localix://resource/git/PRJ-1/commits/aaaaaaa/src/b.ts')
    expect(r.ok).toBe(true)
    expect(r.language).toBe('diff')
    expect(r.content).toContain('src/b.ts')
  })

  test('status leaf expands to working status + working diff', async () => {
    const r = await p.expand('u', 'localix://resource/git/PRJ-1/status')
    expect(r.ok).toBe(true)
    expect(r.content).toContain('modified a.txt')
    expect(r.content).toContain('+wip')
  })

  test('every repo-node expansion carries the repo path (so the agent runs git there)', async () => {
    for (const uri of [
      'localix://resource/git/PRJ-1',
      'localix://resource/git/PRJ-1/status',
      'localix://resource/git/PRJ-1/staged',
      'localix://resource/git/PRJ-1/branches/feature/x',
      'localix://resource/git/PRJ-1/commits/aaaaaaa',
    ]) {
      const r = await p.expand('u', uri)
      expect(r.content).toContain('Repository path')
      expect(r.content).toContain(CWD)
    }
  })

  test('non-git uri and unknown project are rejected', async () => {
    expect((await p.expand('u', 'db://x')).ok).toBe(false)
    expect((await p.expand('u', 'localix://resource/git/NOPE')).ok).toBe(false)
  })
})

describe('git resource provider — multi-root container', () => {
  const p = createGitResourceProvider(
    fakeService({
      listRepos: async (cwd) => [
        { relpath: '', name: 'root', cwd },
        { relpath: 'svc-a', name: 'svc-a', cwd: `${cwd}/svc-a` },
        { relpath: 'nested/svc-b', name: 'svc-b', cwd: `${cwd}/nested/svc-b` },
      ],
    }),
  )

  test('root lists a repo picker — one node per discovered repo (relpath url-encoded)', async () => {
    const nodes = await p.listChildren('u', 'localix://resource/git/PRJ-1')
    expect(nodes.map((n) => n.uri)).toEqual([
      'localix://resource/git/PRJ-1/repos/~',
      'localix://resource/git/PRJ-1/repos/svc-a',
      'localix://resource/git/PRJ-1/repos/nested%2Fsvc-b',
    ])
    expect(nodes.every((n) => n.icon === 'repo' && n.hasChildren)).toBe(true)
  })

  test('drilling a nested repo lists its sections under the nested base', async () => {
    const nodes = await p.listChildren('u', 'localix://resource/git/PRJ-1/repos/svc-a')
    expect(nodes.map((n) => n.uri)).toEqual([
      'localix://resource/git/PRJ-1/repos/svc-a/branches',
      'localix://resource/git/PRJ-1/repos/svc-a/commits',
      'localix://resource/git/PRJ-1/repos/svc-a/status',
      'localix://resource/git/PRJ-1/repos/svc-a/staged',
      'localix://resource/git/PRJ-1/repos/svc-a/unstaged',
    ])
  })

  test('a slash-containing relpath drills further, staying one encoded segment', async () => {
    const nodes = await p.listChildren(
      'u',
      'localix://resource/git/PRJ-1/repos/nested%2Fsvc-b/branches',
    )
    expect(nodes[0].uri).toBe('localix://resource/git/PRJ-1/repos/nested%2Fsvc-b/branches/main')
  })

  test('container root expands to a repo listing WITH each repo path', async () => {
    const r = await p.expand('u', 'localix://resource/git/PRJ-1')
    expect(r.ok).toBe(true)
    expect(r.content).toContain('3 repositories')
    expect(r.content).toContain('svc-a')
    // Each repo lists its on-disk path so the agent can go to the right one.
    expect(r.content).toContain(`${CWD}/svc-a`)
  })

  test('a nested scope leaf expands to that repo diff, carrying the NESTED path', async () => {
    const r = await p.expand('u', 'localix://resource/git/PRJ-1/repos/svc-a/staged')
    expect(r.ok).toBe(true)
    expect(r.content).toContain('+staged')
    // The path is the nested repo's cwd, not the container root.
    expect(r.content).toContain('Repository path')
    expect(r.content).toContain(`${CWD}/svc-a`)
  })

  test('a crafted / unknown nested relpath is refused (no path escape)', async () => {
    // %2E%2E%2F = "../" — decodes to a path not among discovered repos → refused.
    expect(await p.listChildren('u', 'localix://resource/git/PRJ-1/repos/%2E%2E%2Fetc')).toEqual([])
    expect((await p.expand('u', 'localix://resource/git/PRJ-1/repos/%2E%2E%2Fetc/status')).ok).toBe(
      false,
    )
  })
})

/**
 * End-to-end over the REAL git backend + a throwaway repo — validates the
 * bootstrap composition (backend port getCommitFiles/getCommitFileDiff, and
 * getWorkingDiff = backend.getCommitDiff), not just level dispatch.
 */
