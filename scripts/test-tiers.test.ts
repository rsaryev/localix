// Two test tiers. `*.test.ts` is a unit test: no real time, process, shell or file watcher, so a
// package runs its files in parallel workers. `*.integration.test.ts` drives the real thing and
// runs on its own, one file after another, in `test:integration`. A package with integration files
// must keep them out of `test` and run them in `test:integration`, or they either slow and flake
// the parallel run or are never run at all.
import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { scrubGitEnv } from './scratch-git-env.mjs'

const root = resolve(import.meta.dir, '..')
// Reads this repository's index; a hook's GIT_INDEX_FILE must not point it at another one.
const env = scrubGitEnv({ ...process.env })
const INTEGRATION = /\.integration\.test\.[cm]?[jt]sx?$/u

/** Packages (by directory) holding integration test files, from git's index. */
function packagesWithIntegrationTests(): string[] {
  const files = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30_000,
    killSignal: 'SIGKILL',
  })
    .split('\0')
    .filter((file) => INTEGRATION.test(file))
  const owners = new Set<string>()
  for (const file of files) {
    let dir = dirname(file)
    while (dir !== '.' && !gitTracked(join(dir, 'package.json'))) dir = dirname(dir)
    owners.add(dir)
  }
  return [...owners].sort()
}

const tracked = new Set(
  execFileSync('git', ['ls-files', '-z', '--', '*package.json'], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30_000,
    killSignal: 'SIGKILL',
  }).split('\0'),
)
const gitTracked = (path: string) => tracked.has(path)

describe('test tiers', () => {
  const packages = packagesWithIntegrationTests()

  test('integration files exist only inside packages', () => {
    expect(packages).not.toContain('.')
  })

  for (const dir of packages) {
    test(`${dir} runs its integration files in test:integration, not in test`, () => {
      const { scripts = {} } = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'))
      expect(scripts['test:integration']).toMatch(
        /^bun (test|\.\.\/\.\.\/scripts\/test-shards\.mjs \d+) .*\bintegration\.test$/u,
      )
      expect(scripts.test).toContain("--path-ignore-patterns='**/*.integration.test.ts'")
    })
  }

  // Bun reads bunfig.toml only where a run starts, so a package without the line runs its tests
  // with the hook's GIT_* variables and the real network. The plugin template ships to users and
  // the screenshot fixtures are sample projects; neither can name a file of this repository.
  test('every workspace that runs bun test lists the shared preload', () => {
    const missing: string[] = []
    for (const manifest of tracked) {
      const dir = dirname(manifest)
      if (!manifest.endsWith('package.json') || dir === '.' || dir === 'plugins/template') continue
      if (dir.startsWith('docs/')) continue
      const { scripts = {} } = JSON.parse(readFileSync(join(root, manifest), 'utf8'))
      if (!String(scripts.test ?? '').startsWith('bun test')) continue
      const bunfig = join(root, dir, 'bunfig.toml')
      const text = existsSync(bunfig) ? readFileSync(bunfig, 'utf8') : ''
      if (!/testing\/src\/preload\/index\.ts/u.test(text)) missing.push(dir)
    }
    expect(missing).toEqual([])
  })

  test('the whole suite schedules the integration tier', () => {
    expect(readFileSync(join(root, 'scripts/test-all.mjs'), 'utf8')).toContain("'test:integration'")
  })
})
