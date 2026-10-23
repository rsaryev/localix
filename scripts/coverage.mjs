#!/usr/bin/env bun
// Line coverage for every workspace package, measured by Bun and held by three gates (see
// docs/internals/testing.md#coverage):
//
//   bun run coverage                     check every package against config/coverage.json
//   bun run coverage --base origin/main  also require the changed lines to be run by tests
//                                        (CI passes a pull request's base as COVERAGE_BASE)
//   bun run coverage --packages apps/api,packages/agent
//   bun run coverage --update            raise the recorded floors to what was measured
//
// Bun alone cannot gate this: its threshold counts only the files a test happened to import, and
// it judges each shard of a sharded package on its own. So every package's `test` script runs
// under `--coverage`, the shards' reports are merged, and the files no test loads are counted
// from the repository's file list.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { changedLines, evaluate, ratchet } from './coverage-gate/gates.mjs'
import { hasRuntimeCode, mergeCoverage, ownCoverage, parseLcov } from './coverage-gate/lcov.mjs'
import { coverageRuns } from './coverage-gate/runs.mjs'
import { repoRoot as findRepoRoot } from './lib/paths.mjs'

const repoRoot = findRepoRoot()

export const CONFIG_PATH = join(repoRoot, 'config/coverage.json')
const SOURCE = /\.(?:[mc]?ts|tsx|[mc]?js|jsx)$/u
const TEST = /(?:\.test\.|\.spec\.|\.pw\.mjs$|\.d\.[mc]?ts$)/u

/** @param {string[]} args */
function git(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 << 20 })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

/** The repository's files: tracked ones and new ones not yet added, minus the ignored. */
const trackedFiles = () =>
  git(['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(Boolean)

/** Every workspace package with a `test` script, keyed by its directory. */
export function testedPackages(files = trackedFiles()) {
  /** @type {Record<string, string>} */
  const packages = {}
  for (const file of files) {
    if (!file.endsWith('/package.json') || file.includes('node_modules/')) continue
    if (!/^(?:apps|packages|plugins|scripts)\//u.test(file)) continue
    const script = JSON.parse(readFileSync(join(repoRoot, file), 'utf8')).scripts?.test
    if (script) packages[file.slice(0, -'/package.json'.length)] = script
  }
  return packages
}

/**
 * The source files of each package that have code to cover: tracked, not a test, not excluded by
 * the config (test helpers, generated output), and with a statement of their own.
 *
 * @param {string[]} packageDirs
 * @param {string[]} exclude glob patterns relative to the repository
 * @param {string[]} [files] the repository's tracked files
 * @param {(file: string) => string} [read]
 */
export function sourceFiles(
  packageDirs,
  exclude,
  files = trackedFiles(),
  read = (file) => readFileSync(join(repoRoot, file), 'utf8'),
) {
  const globs = exclude.map((pattern) => new Bun.Glob(pattern))
  const dirs = [...packageDirs].sort((a, b) => b.length - a.length)
  /** @type {Record<string, string[]>} */
  const sources = Object.fromEntries(packageDirs.map((dir) => [dir, []]))
  for (const file of files) {
    if (!SOURCE.test(file) || TEST.test(file)) continue
    const owner = dirs.find((dir) => file.startsWith(`${dir}/`))
    if (!owner || globs.some((glob) => glob.match(file))) continue
    if (!hasRuntimeCode(read(file), file)) continue
    sources[owner]?.push(file)
  }
  return sources
}

/**
 * The commit a change is measured against: `--base <ref>` on the command line, or `COVERAGE_BASE`,
 * which CI sets to a pull request's base. Without one, the changed-lines gate is off.
 *
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function coverageBase(argv, env) {
  const index = argv.indexOf('--base')
  if (index !== -1 && argv[index + 1]) return argv[index + 1]
  return env.COVERAGE_BASE || null
}

/** Runs one process and resolves with its exit code and the end of its output. */
function run(argv, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const keep = (chunk) => (output = (output + chunk).slice(-8000))
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })
}

/**
 * Measures the given packages and returns their merged coverage, or the failed runs. Each run is
 * credited only for its own package's files (see `ownCoverage`).
 */
async function measure(packages, outDir, allPackages) {
  const jobs = Object.entries(packages).flatMap(([dir, script]) =>
    coverageRuns(script, join(outDir, dir.replaceAll('/', '__'))).map((argv) => ({ dir, argv })),
  )
  const failed = []
  const width = Math.max(1, Math.floor(availableParallelism() / 2))
  let next = 0
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++]
        const result = await run(job.argv, join(repoRoot, job.dir))
        if (result.code !== 0) failed.push({ ...job, output: result.output })
      }
    }),
  )
  const reports = []
  for (const job of jobs) {
    const dir = job.argv.find((arg) => arg.startsWith('--coverage-dir='))?.slice(15)
    const file = dir && join(dir, 'lcov.info')
    if (file && existsSync(file)) {
      const report = parseLcov(readFileSync(file, 'utf8'), {
        repoRoot,
        runDir: join(repoRoot, job.dir),
      })
      reports.push(ownCoverage(report, job.dir, allPackages))
    }
  }
  return { coverage: mergeCoverage(reports), failed }
}

/** @param {ReturnType<typeof evaluate>} result */
function print(result) {
  const failing = result.packages.filter((row) => !row.ok)
  for (const row of result.packages) {
    const mark = row.ok ? ' ' : '✗'
    console.log(
      `${mark} ${row.pkg.padEnd(34)} ${String(row.percent).padStart(5)}%  floor ${row.floor ?? '—'}`,
    )
  }
  if (result.unloaded.added.length) {
    console.log(`\n✗ ${result.unloaded.added.length} source file(s) no test loads:`)
    for (const file of result.unloaded.added) console.log(`    ${file}`)
  }
  if (result.unloaded.stale.length) {
    console.log(
      `\n✗ now tested or removed; run \`bun run coverage --update\` to drop them from the list:`,
    )
    for (const file of result.unloaded.stale) console.log(`    ${file}`)
  }
  if (result.diff) {
    const { diff } = result
    console.log(
      `\n${diff.ok ? ' ' : '✗'} changed lines run by tests: ${diff.covered}/${diff.total} (${diff.percent}%, needs ${diff.threshold}%)`,
    )
    for (const [file, lines] of Object.entries(diff.uncovered))
      console.log(`    ${file}: ${lines.join(', ')}`)
    for (const file of diff.unloaded) console.log(`    ${file}: no test loads this file`)
  }
  console.log(
    `\n${failing.length} package(s) below their floor; coverage ${result.ok ? 'passes' : 'fails'}.`,
  )
}

async function main(argv) {
  const flag = (name) => argv.includes(name)
  const value = (name) => argv[argv.indexOf(name) + 1]
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  const all = testedPackages()
  const only = flag('--packages') ? value('--packages').split(',') : null
  const packages = only ? Object.fromEntries(only.map((dir) => [dir, all[dir]])) : all
  for (const [dir, script] of Object.entries(packages)) {
    if (!script) throw new Error(`no package with a test script at ${dir}`)
  }

  const outDir = join(tmpdir(), `localix-coverage-${process.pid}`)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  try {
    const { coverage, failed } = await measure(packages, outDir, Object.keys(all))
    if (failed.length) {
      for (const job of failed) console.error(`\n✗ tests failed in ${job.dir}:\n${job.output}`)
      console.error('\nCoverage is not measured while tests fail.')
      return 1
    }
    const sources = sourceFiles(Object.keys(packages), config.exclude)
    const scope = new Set(Object.values(sources).flat())
    const baseline = {
      floors: config.floors,
      // With --packages, only the listed packages' files are judged.
      unloaded: only
        ? config.unloaded.filter((file) => only.some((dir) => file.startsWith(`${dir}/`)))
        : config.unloaded,
    }
    const ref = coverageBase(argv, process.env)
    const base = ref ? git(['merge-base', ref, 'HEAD']).trim() : null
    const changed = base
      ? changedLines(git(['diff', '--unified=0', '--no-color', base]))
      : undefined
    const result = evaluate({
      coverage,
      sources,
      baseline,
      changed,
      diffThreshold: config.diffThreshold,
    })
    print(result)
    if (flag('--update') || flag('--adopt')) {
      const next = ratchet(baseline, result, { adopt: flag('--adopt') })
      const unloaded = only
        ? [
            ...config.unloaded.filter((file) => !only.some((dir) => file.startsWith(`${dir}/`))),
            ...next.unloaded,
          ].sort()
        : next.unloaded
      writeFileSync(
        CONFIG_PATH,
        `${JSON.stringify({ ...config, floors: { ...config.floors, ...next.floors }, unloaded }, null, 2)}\n`,
      )
      console.log(`\nRecorded ${CONFIG_PATH.slice(repoRoot.length + 1)}.`)
      return evaluate({
        coverage,
        sources,
        baseline: { floors: next.floors, unloaded: next.unloaded },
        changed,
        diffThreshold: config.diffThreshold,
      }).ok
        ? 0
        : 1
    }
    return result.ok && scope.size > 0 ? 0 : 1
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2))
}
