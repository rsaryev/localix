// Line coverage as Bun writes it (lcov `SF`/`DA` records), keyed by repository path.
import { isAbsolute, relative, resolve, sep } from 'node:path'

/** @typedef {Map<string, Map<number, number>>} Coverage repository path -> line -> hits */

/**
 * Parses one lcov report. Bun writes `SF:` relative to the directory the run started in, so each
 * path is resolved against `runDir` and stored relative to `repoRoot`; a file outside the
 * repository (a dependency, a temp fixture) is dropped.
 *
 * @param {string} text
 * @param {{ repoRoot: string, runDir: string }} where
 * @returns {Coverage}
 */
export function parseLcov(text, { repoRoot, runDir }) {
  /** @type {Coverage} */
  const coverage = new Map()
  /** @type {Map<number, number> | undefined} */
  let current
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('SF:')) {
      const file = line.slice(3)
      const path = relative(repoRoot, isAbsolute(file) ? file : resolve(runDir, file))
      if (path.startsWith('..') || isAbsolute(path)) {
        current = undefined
        continue
      }
      const key = path.split(sep).join('/')
      current = coverage.get(key) ?? new Map()
      coverage.set(key, current)
    } else if (line.startsWith('DA:') && current) {
      const [number, hits] = line.slice(3).split(',')
      const lineNumber = Number(number)
      current.set(lineNumber, Math.max(current.get(lineNumber) ?? 0, Number(hits)))
    } else if (line === 'end_of_record') {
      current = undefined
    }
  }
  return coverage
}

/**
 * Joins the reports of several runs (shards, packages). A line is covered when any run executed
 * it; the hit count is the largest one seen.
 *
 * @param {Coverage[]} reports
 * @returns {Coverage}
 */
export function mergeCoverage(reports) {
  /** @type {Coverage} */
  const merged = new Map()
  for (const report of reports) {
    for (const [file, lines] of report) {
      const target = merged.get(file) ?? new Map()
      for (const [line, hits] of lines) target.set(line, Math.max(target.get(line) ?? 0, hits))
      merged.set(file, target)
    }
  }
  return merged
}

/**
 * The part of a report that belongs to one package. A package is credited only for its own files:
 * code another package's tests happen to run is not tested by this package, and judging it so
 * would make a package's number depend on which packages ran. A file belongs to the deepest
 * package directory that contains it.
 *
 * @param {Coverage} report
 * @param {string} pkg
 * @param {string[]} packages every package directory
 * @returns {Coverage}
 */
export function ownCoverage(report, pkg, packages) {
  const deepestFirst = [...packages].sort((a, b) => b.length - a.length)
  /** @type {Coverage} */
  const own = new Map()
  for (const [file, lines] of report) {
    if (deepestFirst.find((dir) => file.startsWith(`${dir}/`)) === pkg) own.set(file, lines)
  }
  return own
}

const transpilers = {
  ts: new Bun.Transpiler({ loader: 'ts', trimUnusedImports: true }),
  tsx: new Bun.Transpiler({ loader: 'tsx', trimUnusedImports: true }),
  js: new Bun.Transpiler({ loader: 'js', trimUnusedImports: true }),
}

/**
 * Whether a module has statements of its own to execute. Types vanish when it is transpiled, and
 * a module of nothing else but `export … from` lines only forwards other modules' code: neither
 * has a line a test could cover, so neither counts.
 *
 * @param {string} source
 * @param {string} file used for its extension
 */
export function hasRuntimeCode(source, file) {
  const loader = file.endsWith('.tsx') ? 'tsx' : /\.[mc]?ts$/u.test(file) ? 'ts' : 'js'
  const output = transpilers[loader].transformSync(source)
  return output
    .split(/;|\n/u)
    .map((statement) => statement.trim())
    .some(
      (statement) =>
        statement !== '' && !/^export\s*(\*|\{[^}]*\})\s*(as\s+\w+\s*)?from\s/u.test(statement),
    )
}
