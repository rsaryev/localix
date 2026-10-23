#!/usr/bin/env bun
// The product code budget: Localix stays under `limit` lines of code (config/code-budget.json).
// A line counts when it holds code; comments and blank lines do not, so explaining code never
// costs budget. Only what ships counts: tests, test helpers, generated and vendored code, and the
// tooling that builds, checks and tests the product (see `exclude` in the config) do not.
//
//   bun run check:size          fails when the product code is over the limit
//
// Past the limit, new code is paid for by deleting dead code and duplication elsewhere.
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { codeLines } from './code-budget/lines.mjs'
import { repoRoot as findRepoRoot } from './lib/paths.mjs'

const repoRoot = findRepoRoot()
export const CONFIG_PATH = join(repoRoot, 'config/code-budget.json')
const CODE = /\.(?:[mc]?ts|tsx|[mc]?js|jsx|rs|css)$/u
const NOT_PRODUCT = /(?:\.test\.|\.spec\.|\.pw\.mjs$|\.d\.[mc]?ts$)/u

/**
 * The files the budget counts: code in a counted language that is not a test, a declaration or
 * excluded by the config.
 *
 * @param {string[]} files repository paths
 * @param {string[]} exclude glob patterns
 */
export function budgetFiles(files, exclude) {
  const globs = exclude.map((pattern) => new Bun.Glob(pattern))
  return files.filter(
    (file) => CODE.test(file) && !NOT_PRODUCT.test(file) && !globs.some((glob) => glob.match(file)),
  )
}

/** apps/api, packages/kit, plugins/chess; scripts, vendor and the rest by their first directory. */
function areaOf(file) {
  const parts = file.split('/')
  return ['apps', 'packages', 'plugins'].includes(parts[0] ?? '')
    ? parts.slice(0, 2).join('/')
    : parts[0]
}

/**
 * @param {string[]} files
 * @param {(file: string) => string} read
 * @param {number} limit
 */
export function measureBudget(files, read, limit) {
  /** @type {Map<string, number>} */
  const areas = new Map()
  let total = 0
  for (const file of files) {
    const lines = codeLines(read(file), file)
    total += lines
    const area = areaOf(file) ?? file
    areas.set(area, (areas.get(area) ?? 0) + lines)
  }
  return {
    total,
    limit,
    over: Math.max(0, total - limit),
    ok: total <= limit,
    areas: [...areas]
      .map(([area, lines]) => ({ area, lines }))
      .sort((a, b) => b.lines - a.lines || a.area.localeCompare(b.area)),
  }
}

function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 256 << 20,
  })
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`)
  // The working tree is measured: a file deleted but not yet committed is gone.
  const present = listed.stdout
    .split('\n')
    .filter((file) => file && existsSync(join(repoRoot, file)))
  const files = budgetFiles(present, config.exclude)
  const result = measureBudget(
    files,
    (file) => readFileSync(join(repoRoot, file), 'utf8'),
    config.limit,
  )
  const format = (value) => value.toLocaleString('en-US')
  for (const { area, lines } of result.areas.slice(0, 15)) {
    console.log(`  ${area.padEnd(30)} ${format(lines).padStart(9)}`)
  }
  console.log(
    `\n${result.ok ? ' ' : '✗'} product code: ${format(result.total)} lines in ${format(files.length)} files, limit ${format(result.limit)}`,
  )
  if (!result.ok) {
    console.log(
      `  ${format(result.over)} lines over. Delete dead code and duplication to make room (AGENTS.md#code-budget).`,
    )
  }
  return result.ok ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main()
}
