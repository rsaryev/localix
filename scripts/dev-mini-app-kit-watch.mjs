// Keep the dev workspace's mini app kit current while the API runs: `bun --watch` reloads the API
// on every source edit, and the kit it serves the authoring plugin must not fall behind.
import { existsSync, statSync, watch as fsWatch } from 'node:fs'
import { join } from 'node:path'

import { stageMiniAppKitIntoAsync } from './run-mini-app-kit-stager.mjs'
import { MINI_APP_KIT_INPUTS } from './stage-mini-app-kit.mjs'

/**
 * The kit inputs that decide its LAYOUT: the stagers and the layout contract the API checks the
 * staged kit against. A change here makes the running API reject the kit it
 * reads ("unknown layout"), so it re-stages promptly. Every other input only changes the kit's
 * CONTENT (declarations, styles, tools), which nothing needs within the second.
 */
export const KIT_LAYOUT_INPUTS = MINI_APP_KIT_INPUTS.filter(
  (input) => input.startsWith('scripts/') || input.endsWith('/kit-layout.ts'),
)

/**
 * Re-stage the mini app kit when anything it is made from changes (`MINI_APP_KIT_INPUTS`).
 *
 * The first defect: the kit was staged once at boot while `bun --watch` reloads the API on every
 * source edit, so the API and the kit it reads drifted apart — building a mini app then failed with "The mini app kit … has an unknown layout" until `bun run dev` was restarted.
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
  outKit,
  cacheRoot,
  log = () => {},
  layoutDebounceMs = 1000,
  quietMs = 20_000,
  restageKit = () => stageMiniAppKitIntoAsync({ repoRoot, outKit, cacheRoot }),
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
