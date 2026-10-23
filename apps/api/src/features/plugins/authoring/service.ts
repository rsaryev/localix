import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'

import { isPathBelow } from '../../../lib/path-containment'

import type { DiscoveredPlugin } from '../discovery'
import {
  checkUserPlugin,
  formatPluginCheck,
  type PluginCheckReport,
  type PluginTestRunner,
} from './check'
import { loadPluginKit, type PluginKit } from './kit'
import { USER_PLUGIN_BACKEND_SOURCE, isUserPluginBackendBuild } from './kit-layout'
import { agentInstruction } from './prose'
import {
  PLUGIN_NAME_RE,
  ScaffoldError,
  USER_PLUGIN_AUTHORING_MARKER,
  scaffoldUserPlugin,
  titleCase,
  type ScaffoldResult,
} from './scaffold'
import { pluginUiEntry } from './ui-build'

/**
 * Creating and building USER plugins — the app's side of plugin authoring.
 *
 * The runtime never depends on a plugin; it runs and manages them. So authoring is generic over
 * whatever the kit's template is, writes only into the user's plugins root, and treats a plugin
 * it builds exactly like one the user dropped in: discovered, consented to, loaded. A first-party
 * plugin is never built here (staging built it; its managed copy is not the user's to change).
 */

export interface PluginAuthoringDeps {
  /** Every plugin visible to the user, bundled ones included (names are global). */
  discover(): Promise<DiscoveredPlugin[]>
  /** The user plugins root a new plugin lands in (`~/.localix/plugins`). */
  pluginsRoot: string
  kitDir(): string
  /** A marketplace/git install retains its source and is never a copy to build out. */
  installedSource?(userId: string, name: string): Promise<string | null>
  /**
   * Whether the user allowed this plugin to run. Building runs its code (Bun.build, its tests),
   * and the authoring markers are files the plugin ships itself, so they prove nothing.
   */
  allowed(userId: string, plugin: DiscoveredPlugin): Promise<boolean>
  /** Record consent and notify hosts. Creating a plugin IS asking for it to run. */
  enable(userId: string, name: string): Promise<unknown>
  /** Reverse an activation that may have committed before a later notification failed. */
  disable?(userId: string, name: string): Promise<unknown>
  /** Tell every host a plugin changed (backend reconcile, `resources.changed` to the UI). */
  changed(): void
  runTests?: PluginTestRunner
}

export interface CreatedUserPlugin extends ScaffoldResult {
  report: PluginCheckReport
  /** The turn that builds the copy out, for a request that said what to build. */
  instruction: string
}

export interface PluginAuthoring {
  create(
    userId: string,
    input: { name: string; displayName?: string; description?: string },
  ): Promise<CreatedUserPlugin>
  /**
   * `base`, or the first `base-N` that no plugin, folder or install of another source holds. A
   * creation never edits what is already there, and a refused name only made the model guess
   * again — one round trip per collision — so the host picks the free name and reports it.
   */
  freeName(userId: string, base: string): Promise<string>
  /** Build, test and reload one user plugin. Throws when `name` is not one. */
  build(
    userId: string,
    name: string,
  ): Promise<{ plugin: DiscoveredPlugin; report: PluginCheckReport }>
  /** Rebuild every user plugin authored in the kit layout; `/plugin reload` runs it. */
  rebuildAll(userId: string): Promise<{ name: string; report: PluginCheckReport }[]>
}

export class UserPluginNotFoundError extends Error {}

const MAX_NAME_SUFFIX = 20

/** Older generated copies predate the marker, but carry this exact authoring preamble. */
async function isGeneratedCopy(dir: string, name: string): Promise<boolean> {
  const marker = await fs.readFile(join(dir, USER_PLUGIN_AUTHORING_MARKER), 'utf8').catch(() => '')
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
    guide.includes('This folder is the whole plugin. Localix builds and loads it;')
  )
}

/** A plugin the app builds: the user's own, laid out the way the kit's template is. */
export async function isAuthoredUserPlugin(plugin: DiscoveredPlugin): Promise<boolean> {
  if (plugin.bundled) return false
  if (await isGeneratedCopy(plugin.dir, plugin.manifest.name)) return true
  const builtBackend =
    isUserPluginBackendBuild(plugin.manifest.tools) &&
    existsSync(join(plugin.dir, USER_PLUGIN_BACKEND_SOURCE))
  return builtBackend || pluginUiEntry(plugin.dir) !== null
}

export function createPluginAuthoring(deps: PluginAuthoringDeps): PluginAuthoring {
  /**
   * A plugin the app may build for this user: authored in the kit layout, a folder of the user's
   * own plugins root (never a Claude Code install or an in-place folder, which Localix does not
   * write to), and allowed to run.
   */
  const buildable = async (userId: string, plugin: DiscoveredPlugin): Promise<boolean> =>
    !plugin.claudeCodeInstall &&
    !plugin.inPlaceInstall &&
    isPathBelow(deps.pluginsRoot, plugin.dir) &&
    (await isAuthoredUserPlugin(plugin)) &&
    (await deps.allowed(userId, plugin))
  const kit = (): Promise<PluginKit> => loadPluginKit(deps.kitDir())
  const active = new Map<string, Promise<void>>()
  const withPluginLock = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
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
  const check = async (plugin: DiscoveredPlugin, loaded?: PluginKit) =>
    checkUserPlugin({
      kit: loaded ?? (await kit()),
      pluginDir: plugin.dir,
      name: plugin.manifest.name,
      ...(deps.runTests ? { runTests: deps.runTests } : {}),
    })

  return {
    async freeName(userId, base) {
      if (!PLUGIN_NAME_RE.test(base)) {
        throw new ScaffoldError(`Plugin name "${base}" must be lower-kebab-case.`)
      }
      const taken = new Set((await deps.discover()).map((plugin) => plugin.manifest.name))
      for (let n = 1; n <= MAX_NAME_SUFFIX; n++) {
        const name = n === 1 ? base : `${base}-${n}`
        if (name === 'template' || taken.has(name)) continue
        if (await fs.lstat(join(deps.pluginsRoot, name)).catch(() => null)) continue
        const source = await deps.installedSource?.(userId, name)
        if (source && source !== 'local') continue
        return name
      }
      throw new ScaffoldError(`Every name from "${base}" to "${base}-${MAX_NAME_SUFFIX}" is taken.`)
    },
    create: (userId, input) =>
      withPluginLock(input.name, async () => {
        const source = await deps.installedSource?.(userId, input.name)
        if (source && source !== 'local') {
          throw new ScaffoldError(
            `A plugin named "${input.name}" is installed from another source — choose another name.`,
          )
        }
        const loaded = await kit()
        const takenNames = new Set((await deps.discover()).map((plugin) => plugin.manifest.name))
        const created = await scaffoldUserPlugin({
          kit: loaded,
          pluginsRoot: deps.pluginsRoot,
          name: input.name,
          takenNames,
          ...(input.displayName ? { displayName: input.displayName } : {}),
          ...(input.description ? { description: input.description } : {}),
        })
        let report: PluginCheckReport
        let enableStarted = false
        try {
          // The reference still names its template domain, so residue is the agent's first to-do
          // list. Every executable check must pass before this newly enabled plugin can run.
          report = await checkUserPlugin({
            kit: loaded,
            pluginDir: created.dir,
            name: created.name,
            allowTemplateResidue: true,
            ...(deps.runTests ? { runTests: deps.runTests } : {}),
          })
          if (!report.published) {
            throw new ScaffoldError(
              `The reference plugin did not pass its initial checks:\n${formatPluginCheck(created.name, report, { previousBuild: false })}`,
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
                `Plugin activation failed and its rollback could not be confirmed. The copy remains at ${created.dir}; inspect its enablement before retrying.`,
              )
            }
          }
          // The folder is ours until create returns; leave no half-created plugin that blocks retry.
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
      withPluginLock(name, async () => {
        const plugin = (await deps.discover()).find(
          (candidate) => candidate.manifest.name === name && !candidate.bundled,
        )
        if (!plugin || !(await buildable(userId, plugin))) {
          throw new UserPluginNotFoundError(
            `No user plugin named "${name}" to build — first-party plugins ship built, and a user plugin needs an authored copy, ${USER_PLUGIN_BACKEND_SOURCE} or ui/register.tsx, in your plugins folder, switched on.`,
          )
        }
        const report = await check(plugin)
        if (report.published) deps.changed()
        return { plugin, report }
      }),

    async rebuildAll(userId) {
      const discovered = await deps.discover()
      const authored = await Promise.all(discovered.map((plugin) => buildable(userId, plugin)))
      const plugins = discovered.filter((_, index) => authored[index])
      if (plugins.length === 0) return []
      const loaded = await kit()
      const results = []
      for (const plugin of plugins) {
        const report = await withPluginLock(plugin.manifest.name, () => check(plugin, loaded))
        results.push({ name: plugin.manifest.name, report })
      }
      return results
    },
  }
}
