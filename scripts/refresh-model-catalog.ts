/**
 * Keep the checked-in pi model catalog fresh — the second half of `.githooks/pre-commit`.
 *
 * The catalog under `vendor/pi/packages/ai/src/providers/` is CHECKED IN so the build never fetches
 * mutable external APIs; the cost is that it is only as fresh as the last commit that regenerated
 * it. So the hook regenerates it and lets the result ride along with the commit.
 *
 * Three rules, each for a failure seen or implied:
 *   - It never blocks a commit. models.dev and the provider APIs are third-party; offline or slow
 *     keeps the catalog the commit already has.
 *   - It has a deadline, and runs at most once an hour. A commit is not the place to pay four
 *     network-bound seconds every time — an agent commits dozens of times an hour, and the catalog
 *     does not change that fast. `--force` (and a sync) ignores the window.
 *   - The generator's two outputs are one output: one file per provider under `providers/` and the
 *     aggregator `models.generated.ts` that imports them. Staging only the directory once committed
 *     the deletion of `providers/kimi-coding.models.ts` while the aggregator still imported it.
 *     A refresh that fails `check:model-data` is reverted, never committed.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { run } from './vendor-pi/run'

export const CATALOG = 'vendor/pi/packages/ai/src/providers'
export const AGGREGATOR = 'vendor/pi/packages/ai/src/models.generated.ts'
const PACKAGE = 'vendor/pi/packages/ai'
export const REFRESH_INTERVAL_MS = 60 * 60 * 1000
const GENERATE_TIMEOUT_MS = 90_000

export type RefreshOutcome =
  | 'skipped'
  | 'fresh'
  | 'unchanged'
  | 'refreshed'
  | 'offline'
  | 'reverted'

/** Where the last successful refresh is remembered: inside `.git`, per clone, never committed. */
async function stampPath(root: string): Promise<string> {
  const path = await run(['git', 'rev-parse', '--git-path', 'localix/model-catalog-refreshed'], {
    cwd: root,
  })
  return resolve(root, path.stdout || '.git/localix/model-catalog-refreshed')
}

export async function refreshModelCatalog(
  root: string,
  options: {
    force?: boolean
    now?: number
    generate?: () => Promise<boolean>
    check?: () => Promise<boolean>
  } = {},
): Promise<RefreshOutcome> {
  if (!(await Bun.file(join(root, PACKAGE, 'package.json')).exists())) return 'skipped'
  const now = options.now ?? Date.now()
  const stamp = await stampPath(root)
  const last = Number(await readFile(stamp, 'utf8').catch(() => '0'))
  if (!options.force && now - last < REFRESH_INTERVAL_MS) return 'fresh'

  const generate =
    options.generate ??
    (async () =>
      (
        await run(['bun', 'run', 'generate-models'], {
          cwd: join(root, PACKAGE),
          timeoutMs: GENERATE_TIMEOUT_MS,
        })
      ).ok)
  const check =
    options.check ??
    (async () => (await run(['bun', 'run', 'check:model-data'], { cwd: join(root, PACKAGE) })).ok)

  if (!(await generate())) {
    // Whatever a half-finished generator wrote is not a catalog.
    await run(['git', 'checkout', '--', CATALOG, AGGREGATOR], { cwd: root })
    return 'offline'
  }
  const changed = !(await run(['git', 'diff', '--quiet', '--', CATALOG, AGGREGATOR], { cwd: root }))
    .ok
  const untracked = (
    await run(['git', 'ls-files', '--others', '--exclude-standard', '--', CATALOG], { cwd: root })
  ).stdout
  if (changed || untracked) {
    if (!(await check())) {
      await run(['git', 'checkout', '--', CATALOG, AGGREGATOR], { cwd: root })
      if (untracked) await run(['git', 'clean', '-fq', '--', CATALOG], { cwd: root })
      return 'reverted'
    }
    await run(['git', 'add', '-A', '--', CATALOG, AGGREGATOR], { cwd: root })
  }
  await mkdir(dirname(stamp), { recursive: true })
  await writeFile(stamp, String(now))
  return changed || untracked ? 'refreshed' : 'unchanged'
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..')
  const outcome = await refreshModelCatalog(root, { force: process.argv.includes('--force') })
  const say: Partial<Record<RefreshOutcome, string>> = {
    refreshed: 'pre-commit: refreshed the pi model catalog and staged it',
    offline:
      'pre-commit: could not refresh the pi model catalog (offline or slow) — committing it as-is',
    reverted: 'pre-commit: the regenerated pi model catalog failed check:model-data — reverted it',
  }
  if (say[outcome]) console.error(say[outcome])
  // Never blocks: a stale catalog is a smaller problem than a refused commit.
  process.exit(0)
}
