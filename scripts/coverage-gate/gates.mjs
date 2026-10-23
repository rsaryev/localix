// The coverage gates: every package holds its floor, no source file goes untested, and the lines a
// change touches are run by tests. The recorded baseline only ever gets stricter.

/** @typedef {import('./lcov.mjs').Coverage} Coverage */
/** @typedef {{ floors: Record<string, number>, unloaded: string[] }} Baseline */

/** @param {number} covered @param {number} total */
const percent = (covered, total) => (total ? Math.floor((1000 * covered) / total) / 10 : 100)

/**
 * The lines each file gains or changes in a unified diff (`git diff --unified=0`), on the new side.
 * Deleted files have no new side and are left out.
 *
 * @param {string} diff
 * @returns {Map<string, number[]>}
 */
export function changedLines(diff) {
  /** @type {Map<string, number[]>} */
  const changed = new Map()
  /** @type {number[] | undefined} */
  let current
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4)
      current = target === '/dev/null' ? undefined : []
      if (current) changed.set(target.replace(/^b\//u, ''), current)
      continue
    }
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/u.exec(line)
    if (hunk && current) {
      const start = Number(hunk[1])
      const count = hunk[2] === undefined ? 1 : Number(hunk[2])
      for (let offset = 0; offset < count; offset++) current.push(start + offset)
    }
  }
  return changed
}

/**
 * Checks the measured coverage against the recorded baseline.
 *
 * @param {{
 *   coverage: Coverage,
 *   sources: Record<string, string[]>,
 *   baseline: Baseline,
 *   changed?: Map<string, number[]>,
 *   diffThreshold?: number,
 * }} input `sources` lists, per package, every source file that has code to cover
 */
export function evaluate({ coverage, sources, baseline, changed, diffThreshold = 80 }) {
  const packages = Object.entries(sources)
    .filter(([, files]) => files.length > 0)
    .map(([pkg, files]) => {
      let covered = 0
      let total = 0
      for (const file of files) {
        for (const hits of coverage.get(file)?.values() ?? []) {
          total++
          if (hits > 0) covered++
        }
      }
      const floor = baseline.floors[pkg] ?? null
      const measured = percent(covered, total)
      return {
        pkg,
        covered,
        total,
        percent: measured,
        floor,
        ok: floor !== null && measured >= floor,
      }
    })

  const sourceSet = new Set(Object.values(sources).flat())
  const unloadedNow = [...sourceSet].filter((file) => !coverage.has(file))
  const listed = new Set(baseline.unloaded)
  const unloaded = {
    added: unloadedNow.filter((file) => !listed.has(file)).sort(),
    stale: baseline.unloaded.filter((file) => !unloadedNow.includes(file)).sort(),
  }

  const diff = changed && diffCoverage(coverage, sourceSet, changed, diffThreshold)
  const ok =
    packages.every((row) => row.ok) &&
    unloaded.added.length === 0 &&
    unloaded.stale.length === 0 &&
    (diff ? diff.ok : true)
  return { packages, unloaded, ...(diff ? { diff } : {}), ok }
}

/**
 * @param {Coverage} coverage
 * @param {Set<string>} sources
 * @param {Map<string, number[]>} changed
 * @param {number} threshold
 */
function diffCoverage(coverage, sources, changed, threshold) {
  let covered = 0
  let total = 0
  /** @type {Record<string, number[]>} */
  const uncovered = {}
  /** @type {string[]} */
  const unloaded = []
  for (const [file, lines] of changed) {
    if (!sources.has(file)) continue
    const hits = coverage.get(file)
    if (!hits) {
      unloaded.push(file)
      continue
    }
    for (const line of lines) {
      // A line with no statement on it (a brace, a comment, a type) is not instrumented.
      if (!hits.has(line)) continue
      total++
      if ((hits.get(line) ?? 0) > 0) covered++
      else (uncovered[file] ??= []).push(line)
    }
  }
  const measured = percent(covered, total)
  return {
    covered,
    total,
    percent: measured,
    threshold,
    uncovered,
    unloaded: unloaded.sort(),
    ok: unloaded.length === 0 && measured >= threshold,
  }
}

/**
 * The baseline after a measurement. Floors rise to what was measured and never fall, and the list
 * of files no test loads only loses entries. `adopt` records the first baseline, or a package's
 * first files, from the measurement as it stands.
 *
 * @param {Baseline} baseline
 * @param {ReturnType<typeof evaluate>} measured
 * @param {{ adopt?: boolean }} [options]
 * @returns {Baseline}
 */
export function ratchet(baseline, measured, { adopt = false } = {}) {
  /** @type {Record<string, number>} */
  const floors = {}
  for (const row of measured.packages) {
    const previous = baseline.floors[row.pkg]
    floors[row.pkg] = previous === undefined ? row.percent : Math.max(previous, row.percent)
  }
  const stale = new Set(measured.unloaded.stale)
  const kept = baseline.unloaded.filter((file) => !stale.has(file))
  const unloaded = adopt ? [...new Set([...kept, ...measured.unloaded.added])].sort() : kept
  return { floors, unloaded }
}
