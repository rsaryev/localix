// How to run one package's unit tests under Bun's coverage, from its own `test` script.

/**
 * Splits a package.json script into words the way `sh` would for the simple scripts the
 * workspace uses: whitespace separates words and quotes group them. Anything a shell would
 * interpret (operators, substitutions, redirections) makes the script unmeasurable.
 *
 * @param {string} script
 * @returns {string[] | null}
 */
function words(script) {
  if (/[|&;<>$`()]/u.test(script.replace(/'[^']*'|"[^"]*"/gu, ''))) return null
  // A word is a run of bare, 'single' and "double" quoted pieces: --x='a b' is one word, `--x=a b`.
  return [...script.matchAll(/(?:'[^']*'|"[^"]*"|[^\s'"]+)+/gu)].map((match) =>
    match[0].replace(/'([^']*)'|"([^"]*)"/gu, (_, single, double) => single ?? double),
  )
}

/**
 * The `bun` argument lists that run a package's `test` script under coverage, one per process.
 * A sharded package (`scripts/test-shards.mjs N …`) runs every shard into a directory of its own,
 * so the reports can be merged instead of overwriting each other.
 *
 * @param {string} script the package's `test` script
 * @param {string} outDir where this package's reports go
 * @returns {string[][]}
 */
export function coverageRuns(script, outDir) {
  const argv = words(script)
  const coverage = (index) => [
    '--coverage',
    '--coverage-reporter=lcov',
    `--coverage-dir=${outDir}/${index}`,
  ]
  if (argv?.[0] === 'bun' && argv[1] === 'test') return [['test', ...coverage(0), ...argv.slice(2)]]
  if (argv?.[0] === 'bun' && argv[1]?.endsWith('scripts/test-shards.mjs')) {
    const shards = Number(argv[2])
    if (Number.isInteger(shards) && shards > 0) {
      return Array.from({ length: shards }, (_, index) => [
        'test',
        ...coverage(index),
        `--shard=${index + 1}/${shards}`,
        ...argv.slice(3),
      ])
    }
  }
  throw new Error(`cannot measure coverage for test script "${script}"`)
}
