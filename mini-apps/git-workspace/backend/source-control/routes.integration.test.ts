/**
 * The routes over a REAL git repository, exercised through Hono's own
 * `app.request()` — no server, no port, mounted the way the backend host mounts
 * them (request scope in `c.env`).
 *
 * What this file pins is the WIRE, which unit tests below it cannot see: the
 * panel reads one `/workspace` envelope per poll and every write answers with
 * the state it invalidated, so a shape drift on either side is a UI that renders
 * `undefined` rather than a compiler error. It runs real git because that is the
 * only way to know the envelope describes the repository it claims to.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import type {
  SourceControlMutation,
  SourceControlWorkspace,
  SourceControlWorkspaceWire,
} from './contracts'
import { fromWorkspaceWire } from './workspace-wire'
import { runGit } from './git/cli'
import { createGitBackend } from './git/backend'
import { createBackendResolver } from './ports'
import { createRepoWorkspaceService } from './repos/service'
import { createSourceControlRoutes } from './routes'
import { createSourceControlService } from './service'
import { createForgeService } from './forge/service'

let container: string
let repo: string
let call: (path: string, init?: RequestInit) => Promise<Response> | Response
let post: (path: string, body: unknown) => Promise<Response> | Response

/** git with a deterministic identity and no signing — a dev machine may enable both globally. */
const git = (args: string[]) =>
  runGit(repo, [
    '-c',
    'user.email=test@example.com',
    '-c',
    'user.name=Test',
    '-c',
    'commit.gpgsign=false',
    ...args,
  ])

// The routes run their own git, which does not go through the `git()` helper above. A merge or
// commit there needs an identity: macOS derives one from the account name, Linux (CI) has none and
// git stops with "Please tell me who you are", which the merge route reports as `git_merge_failed`
// instead of the conflict the test sets up. The environment is the identity every child inherits.
const IDENTITY_ENV = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
} as const
const previousIdentity: Record<string, string | undefined> = {}

beforeAll(async () => {
  for (const [key, value] of Object.entries(IDENTITY_ENV)) {
    previousIdentity[key] = process.env[key]
    process.env[key] = value
  }
  // realpath: on macOS `/var` is a symlink, and git reports the resolved form.
  container = await realpath(await mkdtemp(join(tmpdir(), 'sc-routes-')))
  repo = join(container, 'proj')
  // The branch is named, not left to `init.defaultBranch`: the assertions below say `main`, and a
  // machine without that global setting would otherwise start on `master`.
  await runGit(container, ['init', '-q', '-b', 'main', 'proj'])
  await writeFile(join(repo, 'a.txt'), 'a\n')
  await git(['add', '.'])
  await git(['commit', '-qm', 'base'])
  await git(['branch', 'feature/one'])
  await git(['branch', 'feature/two'])

  const backend = createGitBackend()
  const repoWorkspace = createRepoWorkspaceService({
    // Session-scoped, as the host's is: an unknown session has no working
    // directory, which is the "not a repository" path the panel must survive.
    resolveScanRoot: async (_userId, sessionId) => (sessionId === 's1' ? container : null),
    backend,
  })
  const service = createSourceControlService({
    resolveCwd: (userId, sessionId, repoRoot) =>
      repoWorkspace.resolveRepoCwd(userId, sessionId, repoRoot),
    listRepoStatuses: (userId, sessionId) => repoWorkspace.listRepoStatuses(userId, sessionId),
    resolveBackend: createBackendResolver([backend]),
  })
  const forge = createForgeService({
    resolveCwd: (userId, sessionId, repoRoot) =>
      repoWorkspace.resolveRepoCwd(userId, sessionId, repoRoot),
    // The forge probe must never be asked to shell out to `gh` in a unit run.
    backend: { id: 'none', detect: async () => false } as never,
  })

  const app = new Hono()
  app.route('/rpc/source-control', createSourceControlRoutes(service, forge) as never)
  call = (path, init) =>
    app.request(`/rpc/source-control${path}`, init, {
      userId: 'user-a',
      projectId: '',
      cwd: container,
    })
  post = (path, body) =>
    call(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
})

afterAll(async () => {
  for (const key of Object.keys(IDENTITY_ENV)) {
    if (previousIdentity[key] === undefined) delete process.env[key]
    else process.env[key] = previousIdentity[key]
  }
  await rm(container, { recursive: true, force: true })
})

const wireOf = async (query: string): Promise<SourceControlWorkspaceWire> => {
  const res = await call(`/workspace?${query}`)
  expect(res.status).toBe(200)
  return (await res.json()) as SourceControlWorkspaceWire
}

// Read the way the panel's client does, so these tests pin the envelope the UI sees.
const workspace = async (repoRoot = repo): Promise<SourceControlWorkspace> =>
  fromWorkspaceWire(await wireOf(`sessionId=s1&repoRoot=${encodeURIComponent(repoRoot)}`))

describe('GET /workspace', () => {
  test('the focused status rides the wire once, as its repo row', async () => {
    const wire = await wireOf(`sessionId=s1&repoRoot=${encodeURIComponent(repo)}`)
    expect(wire.status).toBeUndefined()
    expect(fromWorkspaceWire(wire).status).toBe(wire.repos[0]!.status)
  })

  test('one request carries repos, status, branches and stashes', async () => {
    const body = await workspace()

    expect(body.activeRepo).toBe(repo)
    expect(body.repos.map((r) => r.root)).toEqual([repo])
    expect(body.status.isRepo).toBe(true)
    expect(body.status.root).toBe(repo)
    expect(body.status.branch).toBeTruthy()
    expect(body.branches.branches.map((b) => b.name).sort()).toEqual([
      'feature/one',
      'feature/two',
      'main',
    ])
    // No remote configured — an empty list, never a missing field.
    expect(body.branches.remotes).toEqual([])
    expect(body.stashes).toEqual([])
  })

  test('the repo row and the focused status describe the SAME snapshot', async () => {
    await writeFile(join(repo, 'b.txt'), 'b\n')
    try {
      const body = await workspace()
      // The old `/repos` + `/status` pair computed these from two sequential
      // reads of one tree, so they could disagree about what was dirty.
      expect(body.repos[0]?.status).toEqual(body.status)
      expect(body.status.files.map((f) => f.path)).toEqual(['b.txt'])
    } finally {
      await rm(join(repo, 'b.txt'), { force: true })
    }
  })

  test('omitting the focus still finds the repo discovery knows about', async () => {
    const body = fromWorkspaceWire(await wireOf('sessionId=s1'))
    expect(body.activeRepo).toBe(repo)
    expect(body.status.isRepo).toBe(true)
  })

  test('a session with no working directory answers with the empty envelope, not an error', async () => {
    // No active repo: the status is sent in full, there is no row to restore it from.
    const wire = await wireOf('sessionId=unknown')
    expect(wire.status).toBeDefined()
    const body = fromWorkspaceWire(wire)
    expect(body.status.isRepo).toBe(false)
    expect(body.activeRepo).toBeNull()
    expect(body.branches.remotes).toEqual([])
    expect(body.repos).toEqual([])
  })
})

describe('writes answer with what they invalidated', () => {
  test('deleting a branch returns the shortened branch list with it', async () => {
    const res = await post('/delete-branch', {
      sessionId: 's1',
      name: 'feature/two',
      force: true,
      repoRoot: repo,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as SourceControlMutation

    expect(body.status.isRepo).toBe(true)
    // The whole point: no second request is needed to learn the branch is gone.
    expect(body.branches?.branches.map((b) => b.name)).not.toContain('feature/two')
    expect(body.stashes).toBeUndefined()
  })

  test('staging returns the status ALONE — nothing else could have moved', async () => {
    await writeFile(join(repo, 'staged.txt'), 's\n')
    const res = await post('/stage', { sessionId: 's1', paths: ['staged.txt'], repoRoot: repo })
    expect(res.status).toBe(200)
    const body = (await res.json()) as SourceControlMutation

    expect(body.status.files.find((f) => f.path === 'staged.txt')?.staged).toBe(true)
    expect(body.branches).toBeUndefined()

    await post('/discard', { sessionId: 's1', paths: ['staged.txt'], repoRoot: repo })
  })

  test('a stash write returns the stack', async () => {
    await writeFile(join(repo, 'a.txt'), 'a-changed\n')
    const res = await post('/stash', { sessionId: 's1', repoRoot: repo })
    expect(res.status).toBe(200)
    const body = (await res.json()) as SourceControlMutation

    expect(body.stashes).toHaveLength(1)
    expect(body.status.files).toEqual([])
    await post('/stash-drop', { sessionId: 's1', index: 0, repoRoot: repo })
  })
})

describe('merge', () => {
  test('merges a branch into the current one and reports the new HEAD', async () => {
    await post('/create-branch', { sessionId: 's1', name: 'merge-me', repoRoot: repo })
    await writeFile(join(repo, 'merged.txt'), 'm\n')
    await git(['add', '.'])
    await git(['commit', '-qm', 'on merge-me'])
    await post('/switch', { sessionId: 's1', branch: 'main', repoRoot: repo })

    const res = await post('/merge', { sessionId: 's1', branch: 'merge-me', repoRoot: repo })
    expect(res.status).toBe(200)
    const body = (await res.json()) as SourceControlMutation
    expect(body.status.branch).toBe('main')
    expect(body.branches?.current).toBe('main')
    const head = await git(['log', '-1', '--pretty=%s'])
    expect(head.stdout.trim()).toBe('on merge-me')
  })

  test('a conflicted merge is a typed 409, and the conflict is in the Changes tree', async () => {
    await post('/create-branch', { sessionId: 's1', name: 'left', repoRoot: repo })
    await writeFile(join(repo, 'conflict.txt'), 'left\n')
    await git(['add', '.'])
    await git(['commit', '-qm', 'left'])
    await post('/switch', { sessionId: 's1', branch: 'main', repoRoot: repo })
    await writeFile(join(repo, 'conflict.txt'), 'right\n')
    await git(['add', '.'])
    await git(['commit', '-qm', 'right'])

    const res = await post('/merge', { sessionId: 's1', branch: 'left', repoRoot: repo })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { code: string } }
    // Its OWN code: the merge is IN PROGRESS, not failed, and the UI offers an
    // abort rather than a red toast.
    expect(body.error.code).toBe('git_merge_conflict')

    const after = await workspace()
    expect(after.status.files.some((f) => f.status === 'conflicted')).toBe(true)

    const aborted = await post('/merge-abort', { sessionId: 's1', repoRoot: repo })
    expect(aborted.status).toBe(200)
    expect(((await aborted.json()) as SourceControlMutation).status.files).toEqual([])
  })
})

describe('typed refusals reach the browser as typed refusals', () => {
  /**
   * The regression this pins is a whole class. The backend host serves a mini app
   * app with `wrapper.fetch(...)`, so a throw is caught by THAT app — never the
   * host's error boundary. Without `app.onError(defaultErrorHandler)` every one
   * of these became a bare 500 with a text body, `unwrapMiniAppResponse` found no
   * envelope, and each `err.code === …` branch in the UI that offers the recovery
   * was unreachable code.
   */
  test('an unmerged branch delete answers 409 git_branch_not_merged — the code the retry hangs off', async () => {
    await post('/create-branch', { sessionId: 's1', name: 'unmerged', repoRoot: repo })
    await writeFile(join(repo, 'only-here.txt'), 'x\n')
    await git(['add', '.'])
    await git(['commit', '-qm', 'only on unmerged'])
    await post('/switch', { sessionId: 's1', branch: 'main', repoRoot: repo })

    const res = await post('/delete-branch', {
      sessionId: 's1',
      name: 'unmerged',
      force: false,
      repoRoot: repo,
    })

    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('git_branch_not_merged')
    expect(body.error.message).toMatch(/not fully merged/i)

    // …and the forced retry the UI offers on that code actually works.
    const forced = await post('/delete-branch', {
      sessionId: 's1',
      name: 'unmerged',
      force: true,
      repoRoot: repo,
    })
    expect(forced.status).toBe(200)
    expect(
      ((await forced.json()) as SourceControlMutation).branches?.branches.map((b) => b.name),
    ).not.toContain('unmerged')
  })
})

describe('validation', () => {
  test('a bad body fails with the shared {error:{code,message}} envelope', async () => {
    const res = await post('/merge', { sessionId: 's1', branch: '', repoRoot: repo })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('validation_error')
    expect(body.error.message).toBeTruthy()
  })

  test('a "hash" that is a flag never reaches git — `--hard` cannot ride a soft reset', async () => {
    // git reads an argv entry starting with `-` as an option: `reset --soft --hard` IS a hard
    // reset, and `checkout -f` discards the tree. Both would skip the UI's confirm.
    await writeFile(join(repo, 'a.txt'), 'dirty\n')
    for (const [path, body] of [
      ['/reset', { hash: '--hard', mode: 'soft' }],
      ['/checkout-commit', { hash: '-f' }],
      ['/merge', { branch: '--abort' }],
    ] as const) {
      const res = await post(path, { sessionId: 's1', repoRoot: repo, ...body })
      expect({ path, status: res.status }).toEqual({ path, status: 400 })
    }
    expect(await Bun.file(join(repo, 'a.txt')).text()).toBe('dirty\n')
    await git(['checkout', '--', 'a.txt'])
  })
})
