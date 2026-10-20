/**
 * The vendor sync against real git: a scratch "upstream" repository and a scratch fork that
 * vendors it with a Localix delta. Every case is a situation a sync has met or will meet —
 * the first sync on a branch that predates snapshots, an upstream edit beside a delta, an upstream
 * edit ON a delta, a delta guard going red, and no network.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { buildSnapshot, findSnapshot } from './snapshot'
import { detect, finish, sync, type SyncContext } from './sync'
import { createVendorFixture, git, UPSTREAM_MANIFEST, write } from './test-fixture'

let dir: string
let upstream: string
let fork: string
let logs: string[]
let ctx: SyncContext
let commitUpstream: (files: Record<string, string>, message: string) => Promise<string>
let cleanup: () => Promise<void>

beforeEach(async () => {
  ;({ dir, upstream, fork, logs, ctx, commitUpstream, cleanup } = await createVendorFixture())
})

afterEach(() => cleanup())

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
