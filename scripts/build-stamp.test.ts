import { afterAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { BUILD_STAMP_ENV, RELEASE_STAMPED_FILES, resolveBuildStamp } from './build-stamp.mjs'

const root = resolve(import.meta.dir, '..')
const scratch = mkdtempSync(join(tmpdir(), 'localix-build-stamp-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const run = (args: string[], cwd: string) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

/** A real repository holding the release-stamped files, so the pathspec is exercised by git. */
function fixtureRepo() {
  const repo = mkdtempSync(join(scratch, 'repo-'))
  run(['init', '-q'], repo)
  run(['config', 'user.email', 'stamp@example.invalid'], repo)
  run(['config', 'user.name', 'stamp'], repo)
  for (const file of [...RELEASE_STAMPED_FILES, 'apps/ui/src/main.ts']) {
    mkdirSync(dirname(join(repo, file)), { recursive: true })
    writeFileSync(join(repo, file), 'version = "0.0.1"\n')
  }
  run(['add', '.'], repo)
  run(['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'fixture'], repo)
  return repo
}

describe('UI build stamp', () => {
  test('a release that only stamped its version is clean, from any working directory', () => {
    const repo = fixtureRepo()
    const commit = run(['rev-parse', '--short', 'HEAD'], repo)
    for (const file of RELEASE_STAMPED_FILES) {
      writeFileSync(join(repo, file), 'version = "1.2.3"\n')
    }

    expect(resolveBuildStamp({ cwd: repo, env: {} })).toBe(commit)
    // Vite resolves from `apps/ui`; a cwd-relative pathspec would miss the stamped files there.
    expect(resolveBuildStamp({ cwd: join(repo, 'apps/ui'), env: {} })).toBe(commit)
  })

  test('any other change still marks the bundle dirty', () => {
    const repo = fixtureRepo()
    const commit = run(['rev-parse', '--short', 'HEAD'], repo)
    writeFileSync(join(repo, 'apps/ui/src/main.ts'), 'changed\n')
    expect(resolveBuildStamp({ cwd: join(repo, 'apps/ui'), env: {} })).toBe(`${commit}-dirty`)

    writeFileSync(join(repo, 'apps/ui/src/new.ts'), 'untracked\n')
    run(['checkout', '--', 'apps/ui/src/main.ts'], repo)
    expect(resolveBuildStamp({ cwd: repo, env: {} })).toBe(`${commit}-dirty`)
  })

  test('an explicit stamp wins over Turbo and git, and a malformed one is refused', () => {
    const git = () => {
      throw new Error('git must not be consulted')
    }
    expect(
      resolveBuildStamp({ env: { [BUILD_STAMP_ENV]: ' abc1234 ', TURBO_HASH: 'f' }, git }),
    ).toBe('abc1234')
    expect(() => resolveBuildStamp({ env: { [BUILD_STAMP_ENV]: 'a b' }, git })).toThrow(
      BUILD_STAMP_ENV,
    )
  })

  test('under Turbo without an explicit stamp, the task hash names the bundle', () => {
    // Git state is not a Turbo input, so a git stamp would be replayed onto other commits.
    const git = () => {
      throw new Error('git must not be consulted')
    }
    expect(resolveBuildStamp({ env: { TURBO_HASH: '0123456789abcdef0123' }, git })).toBe(
      'turbo-0123456789abcdef',
    )
  })

  test('no git is a degraded stamp, not a failed build', () => {
    const git = () => {
      throw new Error('not a repository')
    }
    expect(resolveBuildStamp({ env: {}, git })).toBe('unknown')
  })

  test('Turbo hashes the explicit stamp and the UI build and desktop staging share one owner', () => {
    const turbo = JSON.parse(readFileSync(join(root, 'turbo.json'), 'utf8'))
    expect(turbo.tasks.build.env).toContain(BUILD_STAMP_ENV)

    const vite = readFileSync(join(root, 'apps/ui/vite.config.ts'), 'utf8')
    const sidecar = readFileSync(
      join(root, 'apps/desktop-tauri/scripts/prepare-sidecar.mjs'),
      'utf8',
    )
    for (const source of [vite, sidecar]) {
      expect(source).toContain('build-stamp.mjs')
      expect(source).not.toContain("'status', '--porcelain'")
    }
    expect(sidecar).toContain(`[BUILD_STAMP_ENV]: buildStamp`)
  })
})
