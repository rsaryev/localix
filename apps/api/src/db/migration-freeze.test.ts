import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { migrationDigest } from './migration-ledger'
import { BASELINE_MIGRATION } from './migration-provider'

const folder = join(import.meta.dir, '../../migrations')

// Every database's ledger records the baseline as run, so an edit to it reaches no existing
// database: they keep the old shape and fail the schema check on their next start. That is how
// eight schema bumps in one day each locked out every database before the baseline was frozen.
// A schema change is a new migration file (apps/api/migrations/README.md).
const FROZEN_BASELINE_SHA256 = '9f2d2177b22ee149da2c42cc194087d6a9a8a5c93acc2813a9a7fdd522c485f7'

test('the baseline migration is frozen', async () => {
  const text = (await Bun.file(join(folder, `${BASELINE_MIGRATION}.ts`)).text()).replace(
    /\r\n/g,
    '\n',
  )
  const digest = new Bun.CryptoHasher('sha256').update(text).digest('hex')
  expect(
    digest,
    'The baseline is frozen. Revert the edit and add a new migration instead; see apps/api/migrations/README.md.',
  ).toBe(FROZEN_BASELINE_SHA256)
})

/**
 * Every COMMITTED migration is still here, under its name, with the same code.
 *
 * The baseline freeze above only covered the first file; the rest were editable in review, and a
 * renamed or rewritten migration reaches every database that already ran it as a startup failure
 * ("previously executed migration … is missing") or as a schema no file describes. The runtime
 * ledger (`migration-ledger.ts`) catches that on a database; this catches it before it merges.
 * Comments and formatting may change — the comparison is the ledger's own digest.
 */
test('a committed migration is never renamed, removed or rewritten', () => {
  const git = (args: string[]) =>
    Bun.spawnSync(['git', ...args], {
      cwd: folder,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 10_000,
      killSignal: 'SIGKILL',
    })
  const listed = git(['ls-tree', '--name-only', 'HEAD', '.'])
  // Outside a repository (an unpacked source tarball) there is no history to hold the line.
  if (listed.exitCode !== 0) return
  const committed = listed.stdout
    .toString()
    .split('\n')
    .map((line) => line.trim())
    .filter((file) => file.endsWith('.ts'))
  expect(committed.length).toBeGreaterThan(0)
  const problems = committedMigrationProblems(
    committed,
    (file) => git(['show', `HEAD:./${file}`]).stdout.toString(),
    (file) =>
      readdirSync(folder).includes(file) ? readFileSync(join(folder, file), 'utf8') : null,
  )
  expect(
    problems,
    'Committed migrations are immutable. Restore them and add a new migration; see apps/api/migrations/README.md.',
  ).toEqual([])
})

/** What changed about the committed files: gone (removed or renamed), or their code rewritten. */
function committedMigrationProblems(
  committed: readonly string[],
  before: (file: string) => string,
  now: (file: string) => string | null,
): string[] {
  return committed.flatMap((file) => {
    const current = now(file)
    if (current === null) return [`${file}: removed or renamed`]
    return migrationDigest(before(file)) === migrationDigest(current)
      ? []
      : [`${file}: code changed`]
  })
}

test('POSITIVE CONTROL — a rename and a rewrite are named; a comment edit is not', () => {
  const was = 'export async function up(db) { await sql`CREATE TABLE a (id TEXT)`.execute(db) }'
  const files: Record<string, string> = {
    'kept.ts': `${was}\n// reworded comment`,
    'rewritten.ts': was.replace('TABLE a', 'TABLE b'),
  }
  const problems = committedMigrationProblems(
    ['kept.ts', 'rewritten.ts', 'renamed.ts'],
    () => was,
    (file) => files[file] ?? null,
  )
  expect(problems).toEqual(['rewritten.ts: code changed', 'renamed.ts: removed or renamed'])
})

test('migrations are named <yyyymmdd>T<hhmmss>_<snake_case> and the baseline sorts first', () => {
  const names = readdirSync(folder)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => file.slice(0, -3))
    .sort()
  expect(names[0]).toBe(BASELINE_MIGRATION)
  expect(names.filter((name) => !/^\d{8}T\d{6}_[a-z0-9_]+$/.test(name))).toEqual([])
})
