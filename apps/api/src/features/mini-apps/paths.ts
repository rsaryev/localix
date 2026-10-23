import { join } from 'node:path'

/**
 * Where mini apps live, relative to the user's home or a project folder:
 *
 *   ~/.localix/mini-apps/<name>/              the user's, in every project
 *   <project>/.localix/mini-apps/<name>/      a project's
 *   ~/.localix/mini-apps-data/<name>/         what a mini app keeps (`ctx.dataDir`, `ctx.stateDir`)
 */
export const MINI_APPS_SUBDIR = '.localix/mini-apps'
export const MINI_APPS_DATA_SUBDIR = '.localix/mini-apps-data'

/** What a mini app keeps for the person (`ctx.dataDir`): outlives updates and reinstalls. */
export const miniAppDataDir = (app: string, home: string): string =>
  join(home, MINI_APPS_DATA_SUBDIR, app, 'data')

/** A mini app's internal state (`ctx.stateDir`): caches, indexes, anything it can rebuild. */
export const miniAppStateDir = (app: string, home: string): string =>
  join(home, MINI_APPS_DATA_SUBDIR, app, 'state')
