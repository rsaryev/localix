/**
 * Carrying a newly listed package: it arrives at the upstream commit the fork already holds, with
 * the fork's standing manifest decisions, and a sync refuses to register a snapshot that holds a
 * listed package the tree does not — the case `-s ours` would turn into a silent deletion.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { carry } from './carry'
import { SyncFailure } from './run'
import { sync } from './sync'
import { createVendorFixture, git, manifest, type VendorFixture } from './test-fixture'

const CODEMODE_UPSTREAM = manifest(
  { clean: 'shx rm -rf dist', build: 'tsc -p tsconfig.build.json', test: 'vitest --run' },
  { dependencies: { 'quickjs-wasi': '3.6.2' } },
  '@earendil-works/pi-codemode',
)

let fixture: VendorFixture
beforeEach(async () => {
  fixture = await createVendorFixture({
    'packages/codemode/package.json': CODEMODE_UPSTREAM,
    'packages/codemode/src/index.ts': 'export const sandbox = 1\n',
  })
})
afterEach(() => fixture.cleanup())

test('a listed package arrives at the merged upstream, with the fork manifest decisions', async () => {
  const { fork, ctx, commitUpstream } = fixture
  // Upstream moves on; the package must still come from the commit vendor/pi holds.
  await commitUpstream({ 'packages/codemode/src/index.ts': 'export const sandbox = 2\n' }, 'u1')

  expect(await carry(ctx)).toBe('carried')
  const vendored = (path: string) => readFile(join(fork, 'vendor/pi', path), 'utf8')
  expect(await vendored('packages/codemode/src/index.ts')).toBe('export const sandbox = 1\n')
  const carried = JSON.parse(await vendored('packages/codemode/package.json'))
  expect(carried.private).toBe(true)
  expect(carried.scripts).toEqual({
    clean: 'shx rm -rf dist',
    build: 'tsc -p tsconfig.build.json',
    'type-check': 'tsc --noEmit -p tsconfig.build.json',
    'test:upstream': 'vitest --run',
  })
  expect(carried.dependencies).toEqual({ 'quickjs-wasi': '3.6.2' })
  // Nothing else moved, and once committed a second run has nothing to do.
  expect(await vendored('packages/ai/src/auth.ts')).toContain('retries = 10 // Localix')
  await git(fork, 'add', '-A')
  await git(fork, 'commit', '-qm', 'carry codemode')
  expect(await carry(ctx)).toBe('up-to-date')
})

test('a sync will not register a snapshot holding a listed package the tree lacks', async () => {
  const error = await sync(fixture.ctx).catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(SyncFailure)
  expect((error as SyncFailure).message).toContain('does not carry packages/codemode yet')
  // Refused before any merge: the fork is exactly as it was.
  expect(await git(fixture.fork, 'status', '--porcelain')).toBe('')
  expect(await git(fixture.fork, 'log', '-1', '--format=%s')).toBe('fork')
})
