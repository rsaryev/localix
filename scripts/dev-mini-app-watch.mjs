// Keep the dev workspace's staged mini apps current while the API runs.
//
// `dev-api.mjs` stages `mini apps/` ONCE at boot. A mini app scaffolded or whose backend was
// edited afterwards therefore did not exist for the API until `bun run dev` was restarted —
// the one workflow (`mini_app_build`) whose whole point is a mini app appearing while you work.
// This watcher maps each filesystem change to the mini app it belongs to, coalesces the burst a
// scaffold or a save produces, and re-stages just that mini app; the API's bundled-mini-app sync
// then picks the new tree up on its next discovery (its memo is ten seconds) or on
// `/mini-app reload`.
import { existsSync, realpathSync, statSync, watch as fsWatch } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { subscribeNative } from '../apps/api/src/features/fs-watch/subscribe'
import {
  readStagingUnavailable,
  restageMiniApp,
  stageMiniAppKitBesideAsync,
} from './stage-dropins.mjs'
import { MINI_APP_KIT_INPUTS } from './stage-mini-app-kit.mjs'
import { BUNDLED_DIRS, bundledRoots } from './lib/bundled-roots.mjs'
import { isClaudeCodePluginOnly } from './lib/extension-manifest.mjs'

/**
 * The kit inputs that decide its LAYOUT: the stagers and the layout contract the API's authoring
 * code checks the staged kit against. A change here makes the running API reject the kit it
 * reads ("unknown layout"), so it re-stages promptly. Every other input only changes the kit's
 * CONTENT (declarations, styles, the template), which nothing needs within the second.
 */
export const KIT_LAYOUT_INPUTS = MINI_APP_KIT_INPUTS.filter(
  (input) => input.startsWith('scripts/') || input.endsWith('/kit-layout.ts'),
)

/**
 * Re-stage the mini app kit when anything it is made from changes (`MINI_APP_KIT_INPUTS`).
 *
 * The first defect: the kit was staged once at boot while `bun --watch` reloads the API on every
 * source edit, so the API's authoring code and the kit it reads drifted apart — `/mini-app create`
 * then failed with "The mini app kit … has an unknown layout" until `bun run dev` was restarted.
 *
 * The second, which the first fix caused: the content inputs are all of `apps/ui/src/app`,
 * `apps/ui/src/shared/ui` and the `dist` of four packages that `turbo dev` rewrites through
 * `tsc --watch` on every save. Re-staging one second after ANY of them — a full stage that runs
 * `tsc` for the kit's declarations, measured at 250–400% CPU for ~3s — meant continuous editing
 * re-staged continuously and cooked the machine, and the stage ran synchronously inside the
 * supervisor that also owns the API. So a layout change re-stages after `layoutDebounceMs`, a
 * content change only once the inputs have been quiet for `quietMs`, a stage never overlaps
 * another (changes during one earn exactly one more), and the stager runs as an async child.
 */
export function watchMiniAppKitInputs({
  repoRoot,
  outMiniApps,
  cacheRoot,
  log = () => {},
  layoutDebounceMs = 1000,
  quietMs = 20_000,
  restageKit = () => stageMiniAppKitBesideAsync({ repoRoot, outMiniApps, cacheRoot }),
  watch = fsWatch,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer
  /** The pending timer is a layout re-stage: a content change must not push it out to `quietMs`. */
  let urgent = false
  let running = false
  let again = false
  const stage = async () => {
    if (running) {
      again = true
      return
    }
    running = true
    try {
      await restageKit()
      log('re-staged the mini app kit')
    } catch (error) {
      log(
        `re-staging the mini app kit failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      running = false
      if (again) {
        again = false
        void stage()
      }
    }
  }
  const schedule = (layout) => {
    if (timer && urgent && !layout) return
    if (timer) clearTimer(timer)
    urgent = layout
    timer = setTimer(
      () => {
        timer = undefined
        urgent = false
        void stage()
      },
      layout ? layoutDebounceMs : quietMs,
    )
  }
  const watchers = MINI_APP_KIT_INPUTS.filter((input) => existsSync(join(repoRoot, input))).map(
    (input) => {
      const path = join(repoRoot, input)
      const layout = KIT_LAYOUT_INPUTS.includes(input)
      return watch(path, { recursive: statSync(path).isDirectory() }, () => schedule(layout))
    },
  )
  for (const watcher of watchers) {
    watcher.on('error', (error) => log(`mini app kit watcher stopped: ${error.message}`))
  }
  return {
    close: () => {
      if (timer) clearTimer(timer)
      for (const watcher of watchers) watcher.close()
    },
  }
}

/** Segments whose changes never alter the STAGED tree: build products, the standalone preview
 *  shell and tests. `ui/` is watched: its sources are built into the staged UI artifact, which
 *  is how a UI edit reaches the running workbench — the same path a release takes. */
const IGNORED_SEGMENTS = new Set(['node_modules', 'dist', '.turbo', 'preview'])
const TEST_FILE_RE = /\.test\.[a-z]+$/u

/**
 * The mini app a change under `mini apps/` belongs to, or null when staging would not change.
 * @param {string | null | undefined} filename path relative to `mini apps/`, as `fs.watch` reports
 * it
 */
export function miniAppNameForChange(filename) {
  if (!filename) return null
  const segments = filename.split(/[\\/]/u).filter(Boolean)
  const [name, ...rest] = segments
  if (!name || name.startsWith('.')) return null
  if (rest.some((segment) => IGNORED_SEGMENTS.has(segment))) return null
  const base = rest[rest.length - 1]
  if (base && TEST_FILE_RE.test(base)) return null
  return name
}

/**
 * The install state a mini app that failed to build may be waiting on: the lockfile and the
 * top level of the root `node_modules` (a newly installed package adds an entry there).
 */
export const DEPENDENCY_INPUTS = ['bun.lock', 'node_modules']

/** What the native watcher never needs to see under `mini apps/` (see {@link IGNORED_SEGMENTS}). */
const NATIVE_IGNORE = [...IGNORED_SEGMENTS].map((segment) => `**/${segment}/**`)

/**
 * `mini apps/` is watched with the NATIVE recursive watcher (the API's file-tree watcher,
 * `apps/api/src/features/fs-watch/subscribe.ts`), not `fs.watch({ recursive: true })`. Bun's
 * recursive watch on macOS delivers only part of a burst — creating three files and a folder in
 * one go surfaced three of fourteen changes — and a scaffold IS a burst, so a freshly created
 * mini app could miss its re-stage entirely and stay invisible until `bun run dev` restarted. The
 * dependency inputs stay on `fs.watch`: they are single, NON-recursive entries.
 *
 * @param {{ repoRoot: string, outMiniApps: string, log?: (line: string) => void, debounceMs?:
 * number,
 *   restage?: typeof restageMiniApp, unavailable?: (outMiniApps: string) => Record<string, string>,
 *   watch?: typeof fsWatch, subscribe?: typeof subscribeNative, setTimer?: typeof setTimeout }} options
 * @returns {{ close: () => void }}
 */
export function watchMiniAppsForRestage({
  repoRoot,
  outMiniApps,
  log = () => {},
  debounceMs = 750,
  restage = restageMiniApp,
  unavailable = readStagingUnavailable,
  watch = fsWatch,
  subscribe = subscribeNative,
  setTimer = setTimeout,
}) {
  const pending = new Map()
  const flush = (name) => {
    pending.delete(name)
    try {
      restage({ repoRoot, outMiniApps, name, log, onMiniAppError: 'skip' })
    } catch (error) {
      log(`re-staging ${name} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  // One debounce per MINI APP, not one global: a scaffold touches ~40 files in one mini app
  // while a save elsewhere is unrelated, and neither should delay the other.
  const schedule = (name) => {
    const existing = pending.get(name)
    if (existing) clearTimeout(existing)
    pending.set(
      name,
      setTimer(() => flush(name), debounceMs),
    )
  }
  // Each bundled folder (mini apps and mini apps) is watched. The REAL path is subscribed and
  // events are made relative to it: FSEvents reports real paths, so a repository reached through
  // a symlink would otherwise relate nothing to the folder.
  const watchers = bundledRoots(repoRoot).map((root) => {
    let bundledDir = root
    try {
      bundledDir = realpathSync(bundledDir)
    } catch {
      /* a missing directory fails the subscription, which logs it */
    }
    return subscribe(
      bundledDir,
      (events) => {
        for (const event of events) {
          const name = miniAppNameForChange(relative(bundledDir, event.path))
          // A built-in plugin is not a mini app: it is staged with the API, not re-staged here.
          if (name && !isClaudeCodePluginOnly(join(bundledDir, name))) schedule(name)
        }
      },
      {
        ignore: NATIVE_IGNORE,
        onError: (error) =>
          log(
            `extension watcher stopped: ${error instanceof Error ? error.message : String(error)}`,
          ),
      },
    )
  })
  // A mini app that failed on an unresolved import is fixed by `bun install`, which changes nothing
  // under `mini apps/` — so without this, the fix the error message asks for left the mini app
  // missing until `bun run dev` was restarted. Only the mini apps the marker names as failed
  // re-stage.
  const dependencyWatchers = DEPENDENCY_INPUTS.map((input) => join(repoRoot, input))
    .filter((path) => existsSync(path))
    .map((path) =>
      watch(path, { recursive: false }, () => {
        for (const name of Object.keys(unavailable(outMiniApps))) schedule(name)
      }),
    )
  for (const dependencyWatcher of dependencyWatchers) {
    dependencyWatcher.on('error', (error) => log(`dependency watcher stopped: ${error.message}`))
  }
  log(
    `watching ${BUNDLED_DIRS.map((dir) => `${dir}${sep}`).join(' and ')} for extensions to re-stage`,
  )
  return {
    close: () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
      for (const watcher of watchers) watcher.close()
      for (const dependencyWatcher of dependencyWatchers) dependencyWatcher.close()
    },
  }
}
