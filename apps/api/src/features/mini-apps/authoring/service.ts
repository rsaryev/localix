import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'

import { isPathBelow } from '../../../lib/path-containment'

import type { DiscoveredMiniApp } from '../discovery'
import {
  checkUserMiniApp,
  formatMiniAppCheck,
  type MiniAppCheckReport,
  type MiniAppTestRunner,
} from './check'
import { loadMiniAppKit, type MiniAppKit } from './kit'
import { USER_MINI_APP_BACKEND_SOURCE, isUserMiniAppBackendBuild } from './kit-layout'
import { agentInstruction } from './prose'
import {
  MINI_APP_NAME_RE,
  ScaffoldError,
  USER_MINI_APP_AUTHORING_MARKER,
  scaffoldUserMiniApp,
  titleCase,
  type ScaffoldResult,
} from './scaffold'
import { miniAppUiEntry } from './ui-build'

/**
 * Creating and building USER mini apps — the app's side of mini app authoring.
 *
 * The runtime never depends on a mini app; it runs and manages them. So authoring is generic over
 * whatever the kit's template is, writes only into the user's mini apps root, and treats a mini app
 * it builds exactly like one the user dropped in: discovered, consented to, loaded. A first-party
 * mini app is never built here (staging built it; its managed copy is not the user's to change).
 */

export interface MiniAppAuthoringDeps {
  /** Every mini app visible to the user, bundled ones included (names are global). */
  discover(): Promise<DiscoveredMiniApp[]>
  /** The user's mini apps root a new one lands in (`~/.localix/mini-apps`). */
  miniAppsRoot: string
  kitDir(): string
  /** A marketplace/git install retains its source and is never a copy to build out. */
  installedSource?(userId: string, name: string): Promise<string | null>
  /**
   * Whether the user allowed this mini app to run. Building runs its code (Bun.build, its tests),
   * and the authoring markers are files the mini app ships itself, so they prove nothing.
   */
  allowed(userId: string, miniApp: DiscoveredMiniApp): Promise<boolean>
  /** Record consent and notify hosts. Creating a mini app IS asking for it to run. */
  enable(userId: string, name: string): Promise<unknown>
  /** Reverse an activation that may have committed before a later notification failed. */
  disable?(userId: string, name: string): Promise<unknown>
  /** Tell every host a mini app changed (backend reconcile, `resources.changed` to the UI). */
  changed(): void
  runTests?: MiniAppTestRunner
}

export interface CreatedUserMiniApp extends ScaffoldResult {
  report: MiniAppCheckReport
  /** The turn that builds the copy out, for a request that said what to build. */
  instruction: string
}

export interface MiniAppAuthoring {
  create(
    userId: string,
    input: { name: string; displayName?: string; description?: string },
  ): Promise<CreatedUserMiniApp>
  /**
   * `base`, or the first `base-N` that no mini app, folder or install of another source holds. A
   * creation never edits what is already there, and a refused name only made the model guess
   * again — one round trip per collision — so the host picks the free name and reports it.
   */
  freeName(userId: string, base: string): Promise<string>
  /** Build, test and reload one user mini app. Throws when `name` is not one. */
  build(
    userId: string,
    name: string,
  ): Promise<{ miniApp: DiscoveredMiniApp; report: MiniAppCheckReport }>
  /** Rebuild every user mini app authored in the kit layout; `/mini-app reload` runs it. */
  rebuildAll(userId: string): Promise<{ name: string; report: MiniAppCheckReport }[]>
}

export class UserMiniAppNotFoundError extends Error {}

const MAX_NAME_SUFFIX = 20

/** Older generated copies predate the marker, but carry this exact authoring preamble. */
async function isGeneratedCopy(dir: string, name: string): Promise<boolean> {
  const marker = await fs
    .readFile(join(dir, USER_MINI_APP_AUTHORING_MARKER), 'utf8')
    .catch(() => '')
  if (marker) {
    try {
      const parsed = JSON.parse(marker) as Record<string, unknown>
      return (
        parsed.schemaVersion === 1 &&
        parsed.name === name &&
        typeof parsed.template === 'string' &&
        parsed.template.length > 0
      )
    } catch {
      return false
    }
  }
  const guide = await fs.readFile(join(dir, 'AGENTS.md'), 'utf8').catch(() => '')
  return (
    guide.startsWith(`# Working on ${titleCase(name)}\n`) &&
    guide.includes('This folder is the whole mini app. Localix builds and loads it;')
  )
}

/** A mini app the app builds: the user's own, laid out the way the kit's template is. */
export async function isAuthoredUserMiniApp(miniApp: DiscoveredMiniApp): Promise<boolean> {
  if (miniApp.bundled) return false
  if (await isGeneratedCopy(miniApp.dir, miniApp.name)) return true
  const builtBackend =
    isUserMiniAppBackendBuild(miniApp.manifest?.backend) &&
    existsSync(join(miniApp.dir, USER_MINI_APP_BACKEND_SOURCE))
  return builtBackend || miniAppUiEntry(miniApp.dir) !== null
}

export function createMiniAppAuthoring(deps: MiniAppAuthoringDeps): MiniAppAuthoring {
  /**
   * A mini app the app may build for this user: authored in the kit layout, a folder of the user's
   * own mini apps root (never a Claude Code install or an in-place folder, which Localix does not
   * write to), and allowed to run.
   */
  const buildable = async (userId: string, miniApp: DiscoveredMiniApp): Promise<boolean> =>
    isPathBelow(deps.miniAppsRoot, miniApp.dir) &&
    (await isAuthoredUserMiniApp(miniApp)) &&
    (await deps.allowed(userId, miniApp))
  const kit = (): Promise<MiniAppKit> => loadMiniAppKit(deps.kitDir())
  const active = new Map<string, Promise<void>>()
  const withMiniAppLock = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    const previous = active.get(name)
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    active.set(name, current)
    if (previous) await previous
    try {
      return await run()
    } finally {
      release()
      if (active.get(name) === current) active.delete(name)
    }
  }
  const check = async (miniApp: DiscoveredMiniApp, loaded?: MiniAppKit) =>
    checkUserMiniApp({
      kit: loaded ?? (await kit()),
      miniAppDir: miniApp.dir,
      name: miniApp.name,
      ...(deps.runTests ? { runTests: deps.runTests } : {}),
    })

  return {
    async freeName(userId, base) {
      if (!MINI_APP_NAME_RE.test(base)) {
        throw new ScaffoldError(`Mini app name "${base}" must be lower-kebab-case.`)
      }
      const taken = new Set((await deps.discover()).map((miniApp) => miniApp.name))
      for (let n = 1; n <= MAX_NAME_SUFFIX; n++) {
        const name = n === 1 ? base : `${base}-${n}`
        if (name === 'template' || taken.has(name)) continue
        if (await fs.lstat(join(deps.miniAppsRoot, name)).catch(() => null)) continue
        const source = await deps.installedSource?.(userId, name)
        if (source && source !== 'local') continue
        return name
      }
      throw new ScaffoldError(`Every name from "${base}" to "${base}-${MAX_NAME_SUFFIX}" is taken.`)
    },
    create: (userId, input) =>
      withMiniAppLock(input.name, async () => {
        const source = await deps.installedSource?.(userId, input.name)
        if (source && source !== 'local') {
          throw new ScaffoldError(
            `A mini app named "${input.name}" is installed from another source — choose another name.`,
          )
        }
        const loaded = await kit()
        const takenNames = new Set((await deps.discover()).map((miniApp) => miniApp.name))
        const created = await scaffoldUserMiniApp({
          kit: loaded,
          miniAppsRoot: deps.miniAppsRoot,
          name: input.name,
          takenNames,
          ...(input.displayName ? { displayName: input.displayName } : {}),
          ...(input.description ? { description: input.description } : {}),
        })
        let report: MiniAppCheckReport
        let enableStarted = false
        try {
          // The reference still names its template domain, so residue is the agent's first to-do
          // list. Every executable check must pass before this newly enabled mini app can run.
          report = await checkUserMiniApp({
            kit: loaded,
            miniAppDir: created.dir,
            name: created.name,
            allowTemplateResidue: true,
            ...(deps.runTests ? { runTests: deps.runTests } : {}),
          })
          if (!report.published) {
            throw new ScaffoldError(
              `The reference mini app did not pass its initial checks:\n${formatMiniAppCheck(created.name, report, { previousBuild: false })}`,
            )
          }
          enableStarted = true
          await deps.enable(userId, created.name)
        } catch (error) {
          if (enableStarted) {
            try {
              if (!deps.disable) throw new Error('No activation rollback is available')
              await deps.disable(userId, created.name)
            } catch {
              throw new ScaffoldError(
                `Mini app activation failed and its rollback could not be confirmed. The copy remains at ${created.dir}; inspect its enablement before retrying.`,
              )
            }
          }
          // The folder is ours until create returns; leave no half-created mini app that blocks
          // retry.
          await fs.rm(created.dir, { recursive: true, force: true })
          throw error
        }
        return {
          ...created,
          report,
          instruction: agentInstruction({ ...created, kit: loaded }),
        }
      }),

    build: (userId, name) =>
      withMiniAppLock(name, async () => {
        const miniApp = (await deps.discover()).find(
          (candidate) => candidate.name === name && !candidate.bundled,
        )
        if (!miniApp || !(await buildable(userId, miniApp))) {
          throw new UserMiniAppNotFoundError(
            `No mini app of yours named "${name}" to build — the ones Localix ships come built, and yours needs an authored copy, ${USER_MINI_APP_BACKEND_SOURCE} or ui/register.tsx, in your mini apps folder, switched on.`,
          )
        }
        const report = await check(miniApp)
        if (report.published) deps.changed()
        return { miniApp, report }
      }),

    async rebuildAll(userId) {
      const discovered = await deps.discover()
      const authored = await Promise.all(discovered.map((miniApp) => buildable(userId, miniApp)))
      const miniApps = discovered.filter((_, index) => authored[index])
      if (miniApps.length === 0) return []
      const loaded = await kit()
      const results = []
      for (const miniApp of miniApps) {
        const report = await withMiniAppLock(miniApp.name, () => check(miniApp, loaded))
        results.push({ name: miniApp.name, report })
      }
      return results
    },
  }
}
