/**
 * The vendor sync against real git: a scratch "upstream" repository and a scratch fork that
 * vendors it with a Localix delta. Every case is a situation a sync has met or will meet —
 * the first sync on a branch that predates snapshots, an upstream edit beside a delta, an upstream
 * edit ON a delta, a delta guard going red, and no network.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { scratchGitEnv } from '../scratch-git-env'
import { buildSnapshot, findSnapshot } from './snapshot'
import { detect, finish, sync, type SyncContext } from './sync'

const env = {
  ...scratchGitEnv(),
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
}
// The scratch repositories must never see the real one's hooks or identity.
Object.assign(process.env, env)

async function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(['git', ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(' ')}: ${err}`)
  return out.trim()
}

async function write(root: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
}

const manifest = (scripts: Record<string, string>, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ name: '@earendil-works/pi-ai', version: '1.0.0', ...extra, scripts }, null, '\t')}\n`

const UPSTREAM_MANIFEST = manifest({ build: 'tsgo -p tsconfig.json', test: 'vitest --run' })
const OUR_MANIFEST = manifest(
  { build: 'tsgo -p tsconfig.json', 'type-check': 'tsc --noEmit', 'test:upstream': 'vitest --run' },
  { private: true },
)

let dir: string
let upstream: string
let fork: string
let logs: string[]
let ctx: SyncContext

async function commitUpstream(files: Record<string, string>, message: string) {
  await write(upstream, files)
  await git(upstream, 'add', '-A')
  await git(upstream, 'commit', '-qm', message)
  return git(upstream, 'rev-parse', 'HEAD')
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vendor-sync-'))
  upstream = join(dir, 'upstream')
  fork = join(dir, 'fork')
  await mkdir(upstream)
  await mkdir(fork)
  await git(upstream, 'init', '-q', '-b', 'main')
  const u0 = await commitUpstream(
    {
      'packages/ai/package.json': UPSTREAM_MANIFEST,
      'packages/ai/src/auth.ts': 'export const port = 1455\nexport const retries = 0\n',
      'packages/ai/src/models.ts': 'export const models = ["a"]\n',
      'README.md': 'upstream only — never vendored\n',
    },
    'u0',
  )

  // The fork: upstream u0 plus a Localix delta in auth.ts and in the manifest.
  await git(fork, 'init', '-q', '-b', 'main')
  await write(fork, {
    'vendor/pi/UPSTREAM.md': `# Vendored pi\n\n- Base commit: \`${u0}\`\n- Upstream version: \`1.0.0\`\n\n\`packages/ai/src/auth.ts\` retries the login port (the Localix recovery delta).\n`,
    'vendor/pi/packages/ai/package.json': OUR_MANIFEST,
    'vendor/pi/packages/ai/src/auth.ts':
      'export const port = 1455\nexport const retries = 10 // Localix\n',
    'vendor/pi/packages/ai/src/models.ts': 'export const models = ["a"]\n',
    'app.ts': 'console.log("the fork")\n',
  })
  await git(fork, 'add', '-A')
  await git(fork, 'commit', '-qm', 'fork')
  logs = []
  ctx = { root: fork, url: upstream, tripwires: [], install: false, log: (line) => logs.push(line) }
})

afterEach(() => rm(dir, { recursive: true, force: true }))

describe('vendor sync', () => {
  test('the first sync registers what is already vendored as the merged snapshot, changing nothing', async () => {
    const before = await git(fork, 'rev-parse', 'HEAD^{tree}')
    expect(await sync(ctx)).toBe('up-to-date')
    expect(await git(fork, 'rev-parse', 'HEAD^{tree}')).toBe(before)
    expect((await findSnapshot(fork))?.upstream).toBe(await git(upstream, 'rev-parse', 'HEAD'))
  })

  // The 0.87 case: upstream edits the `build` line our `type-check` sits beside, and a file
  // we never touched. Both must arrive; our delta must stay.
  test('an upstream edit beside the delta merges cleanly and keeps every Localix line', async () => {
    await sync(ctx)
    const u1 = await commitUpstream(
      {
        'packages/ai/package.json': UPSTREAM_MANIFEST.replace('tsgo', 'tsc'),
        'packages/ai/src/models.ts': 'export const models = ["a", "b"]\n',
      },
      'u1',
    )
    expect(await sync(ctx)).toBe('synced')

    const vendored = (path: string) => readFile(join(fork, 'vendor/pi', path), 'utf8')
    const scripts = JSON.parse(await vendored('packages/ai/package.json')).scripts
    expect(scripts.build).toBe('tsc -p tsconfig.json')
    expect(scripts['type-check']).toBe('tsc --noEmit')
    expect(scripts.test).toBeUndefined()
    expect(JSON.parse(await vendored('packages/ai/package.json')).private).toBe(true)
    expect(await vendored('packages/ai/src/models.ts')).toContain('"b"')
    expect(await vendored('packages/ai/src/auth.ts')).toContain('retries = 10 // Localix')
    expect(await vendored('UPSTREAM.md')).toContain(`Base commit: \`${u1}\``)
    // A real merge commit, and the rest of the fork untouched.
    expect((await git(fork, 'log', '-1', '--format=%P')).split(' ')).toHaveLength(2)
    expect(await readFile(join(fork, 'app.ts'), 'utf8')).toBe('console.log("the fork")\n')
    expect(await git(fork, 'status', '--porcelain')).toBe('')
  })

  test('an upstream edit ON the delta stops as an ordinary conflict, named with its delta note', async () => {
    await sync(ctx)
    await commitUpstream(
      { 'packages/ai/src/auth.ts': 'export const port = 1455\nexport const retries = 3\n' },
      'u1',
    )
    expect(await sync(ctx)).toBe('conflicts')
    expect(await git(fork, 'diff', '--name-only', '--diff-filter=U')).toBe(
      'vendor/pi/packages/ai/src/auth.ts',
    )
    expect(logs.join('\n')).toContain('retries the login port')

    // Resolved the way a person would: keep our delta.
    await write(fork, {
      'vendor/pi/packages/ai/src/auth.ts':
        'export const port = 1455\nexport const retries = 10 // Localix\n',
    })
    await git(fork, 'add', 'vendor/pi/packages/ai/src/auth.ts')
    expect(await finish(ctx)).toBe('synced')
    expect(await git(fork, 'status', '--porcelain')).toBe('')
  })

  test('a red delta guard commits nothing and leaves the merge to fix', async () => {
    await sync(ctx)
    await commitUpstream({ 'packages/ai/src/models.ts': 'export const models = []\n' }, 'u1')
    await write(fork, {
      'guard.test.ts':
        "import { test, expect } from 'bun:test'\ntest('delta', () => expect(1).toBe(2))\n",
    })
    await git(fork, 'add', 'guard.test.ts')
    await git(fork, 'commit', '-qm', 'guard')
    const head = await git(fork, 'rev-parse', 'HEAD')
    const guarded = { ...ctx, tripwires: [{ path: 'guard.test.ts', delta: 'the test delta' }] }
    expect(await sync(guarded)).toBe('guards-failed')
    expect(await git(fork, 'rev-parse', 'HEAD')).toBe(head)
    expect(await git(fork, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).toBeTruthy()
    expect(logs.join('\n')).toContain('guard FAILED — the test delta')
  })

  test('snapshots are deterministic, so two machines syncing the same upstream converge', async () => {
    const head = await git(upstream, 'rev-parse', 'HEAD')
    const a = await buildSnapshot({ root: fork, url: upstream, upstream: head })
    const b = await buildSnapshot({ root: fork, url: upstream, upstream: head })
    expect(a.commit).toBe(b.commit)
    // Only the vendored packages are in it — never the rest of upstream's repository.
    expect(await git(fork, 'ls-tree', '-r', '--name-only', a.commit)).not.toContain('README.md')
  })

  test('detect: current, behind, and offline never blocks', async () => {
    expect(await detect(ctx)).toBe('current')
    await commitUpstream({ 'packages/ai/src/models.ts': 'export const models = ["c"]\n' }, 'u1')
    expect(await detect(ctx)).toBe('behind')
    expect(logs.join('\n')).toContain('bun run vendor:sync')
    expect(await detect({ ...ctx, url: join(dir, 'missing') })).toBe('offline')
  })
})
