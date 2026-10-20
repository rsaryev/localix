/**
 * `bun scripts/vendor-pi/cli.ts <command>` — the one entry point for the vendored pi fork.
 *
 *   sync       bun run vendor:sync            merge upstream as its own commit
 *   continue   bun run vendor:sync:continue   after resolving conflicts or fixing a guard
 *   abort      bun run vendor:sync:abort      drop the sync in progress
 *   carry      bun run vendor:carry           bring a newly listed package in at the merged upstream
 *   detect     (pre-commit)                   exit 1 when upstream is ahead of what is merged
 *
 * Exit codes are for the hook and for agents: 0 done or nothing to do, 1 a decision is needed
 * (conflicts, a red guard, upstream ahead), 2 the tooling itself failed.
 */
import { resolve } from 'node:path'

import { carry } from './carry'
import { TRIPWIRES } from './config'
import { SyncFailure } from './run'
import { abort, defaultContext, detect, finish, sync, type SyncOutcome } from './sync'

const root = resolve(import.meta.dir, '..', '..')
const ctx = defaultContext(root, TRIPWIRES)
const exitFor = (outcome: SyncOutcome) => (outcome === 'synced' || outcome === 'up-to-date' ? 0 : 1)

async function dispatch(command: string): Promise<number> {
  switch (command) {
    case 'sync':
      return exitFor(await sync(ctx))
    case 'continue':
      return exitFor(await finish(ctx))
    case 'abort':
      await abort(ctx)
      return 0
    case 'carry':
      await carry(ctx)
      return 0
    case 'detect':
      if (process.env.LOCALIX_SKIP_VENDOR_PI_SYNC === '1') return 0
      return (await detect(ctx)) === 'behind' ? 1 : 0
    default:
      console.error('usage: bun scripts/vendor-pi/cli.ts sync | continue | abort | carry | detect')
      return 2
  }
}

try {
  process.exit(await dispatch(process.argv[2] ?? ''))
} catch (error) {
  if (error instanceof SyncFailure) {
    console.error(`vendor/pi: ${error.message}`)
    if (error.detail) console.error(error.detail)
    process.exit(1)
  }
  console.error(error)
  process.exit(2)
}
