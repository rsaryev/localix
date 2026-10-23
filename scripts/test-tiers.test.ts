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

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/u
// Flags of `bun test` that take the next word as their value.
const VALUE_FLAGS = new Set(['--preload', '--timeout'])

/** The directories a package's `test` script runs, relative to the package; [] means all of it. */
function testTargets(script: string): string[] {
  const words = script.split(/\s+/u).filter(Boolean)
  const start =
    words[1] === 'test' ? 2 : (words[1] ?? '').endsWith('test-shards.mjs') ? 3 : words.length
  const targets: string[] = []
  for (let index = start; index < words.length; index++) {
    const word = words[index] ?? ''
    if (VALUE_FLAGS.has(word)) index++
    else if (!word.startsWith('-')) targets.push(word.replace(/^\.\//u, '').replace(/\/$/u, ''))
  }
  return targets.filter((target) => target !== '.')
}

/** Test files no package's `test` or `test:integration` script reaches. */
function unscheduledTestFiles(): string[] {
  const files = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30_000,
    killSignal: 'SIGKILL',
  })
    .split('\0')
    .filter((file) => TEST_FILE.test(file) && !file.includes('/vendor/'))
  const missing: string[] = []
  for (const file of files) {
    let dir = dirname(file)
    while (dir !== '.' && !gitTracked(join(dir, 'package.json'))) dir = dirname(dir)
    const { scripts = {} } = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'))
    if (INTEGRATION.test(file) && scripts['test:integration']) continue
    const targets = dir === '.' || !scripts.test ? null : testTargets(scripts.test)
    const inside = file.slice(dir.length + 1)
    const reached =
      targets !== null &&
      (targets.length === 0 || targets.some((target) => inside.startsWith(`${target}/`)))
    if (!reached) missing.push(file)
  }
  return missing.sort()
}

describe('test tiers', () => {
  const packages = packagesWithIntegrationTests()

  test('a script’s targets are its paths, not its flags or their values', () => {
    expect(
      testTargets(
        "bun ../../scripts/test-shards.mjs 4 --no-orphans --path-ignore-patterns='**/*.integration.test.ts' src scripts",
      ),
    ).toEqual(['src', 'scripts'])
    expect(testTargets('bun test --preload ../../packages/kit/test-preload.ts .')).toEqual([])
    expect(testTargets('bun test ui backend shared')).toEqual(['ui', 'backend', 'shared'])
  })

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
  // with the hook's GIT_* variables and the real network. The mini app template ships to users and
  // the screenshot fixtures are sample projects; neither can name a file of this repository.
  test('every workspace that runs bun test lists the shared preload', () => {
    const missing: string[] = []
    for (const manifest of tracked) {
      const dir = dirname(manifest)
      if (!manifest.endsWith('package.json') || dir === '.' || dir === 'mini-apps/template')
        continue
      if (dir.startsWith('docs/')) continue
      const { scripts = {} } = JSON.parse(readFileSync(join(root, manifest), 'utf8'))
      if (!String(scripts.test ?? '').startsWith('bun test')) continue
      const bunfig = join(root, dir, 'bunfig.toml')
      const text = existsSync(bunfig) ? readFileSync(bunfig, 'utf8') : ''
      if (!/testing\/src\/preload\/index\.ts/u.test(text)) missing.push(dir)
    }
    expect(missing).toEqual([])
  })

  // One test script per tier, here as in every package: a tier of its own (a "system", "repo" or
  // "slow" list) is a second place a test must be registered, and the one it is forgotten in.
  test('the repository runs two tiers, `test` and `test:integration`, both through Turbo', () => {
    const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    // `test:screenshots` runs capture scenarios on request (AGENTS.md), not a tier.
    const onRequest = new Set(['test:screenshots'])
    expect(
      Object.keys(scripts).filter((name) => /^test\b/u.test(name) && !onRequest.has(name)),
    ).toEqual(['test', 'test:integration'])
    expect(scripts.test).toStartWith('bunx turbo test ')
    expect(scripts['test:integration']).toStartWith('bunx turbo test:integration ')
  })

  test('every test file lives where its package’s test script runs it', () => {
    expect(unscheduledTestFiles()).toEqual([])
  })
})
