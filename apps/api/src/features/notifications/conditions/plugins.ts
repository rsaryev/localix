import { errorMessage } from '../../../lib/errors'
import { recoveryAction } from '../recovery'
import type { InboxOrigin } from '../contracts'
import { createConditions, type ConditionJournal } from './condition'

/**
 * WHAT IS WRONG WITH A CLAUDE CODE PLUGIN, as standing conditions — one subject per part that can
 * break. Each was a `logger.warn` and nothing else; each is now a subject under `plugin:<name>:`,
 * so an uninstalled plugin retires all of them at once (`enabled`), and each part clears when it
 * works again:
 *
 *   plugin:<name>:load:<projectId>:     the load reported an error for that scope ('' = global)
 *   plugin:<name>:monitor:<monitor>:    a `when: always` monitor stopped running
 *   plugins:load:<projectId>:           the per-run load of a scope's plugins threw
 *
 * `plugins:` is its own root, not a plugin named "load". A mini app's conditions are
 * `conditions/mini-apps.ts`.
 */

export interface PluginLoadOutcome {
  name: string
  displayName?: string
  /** '' for a global plugin, else the project whose catalog it came from. */
  projectId: string
  error?: string
}

export interface PluginConditions {
  /** One plugin's load finished, with or without an error. */
  loaded(userId: string, outcome: PluginLoadOutcome): void
  /** The enabled set, across every scope: rows about any other plugin are retired. */
  enabled(names: ReadonlySet<string>): Promise<void>
  /** The per-run load of a scope's plugins as a whole: `error` when it threw. */
  catalogLoaded(userId: string, projectId: string, error?: string): void
  monitorStarted(pluginName: string, monitorName: string): void
  monitorStopped(pluginName: string, monitorName: string, detail: string): void
}

/** `userId` is who owns the process-wide hosts (monitors): the default user. */
export function createPluginConditions(
  journal: ConditionJournal,
  userId: string,
): PluginConditions {
  const conditions = createConditions(journal)
  /** Display names learned from loads, for the hosts that only know the manifest name. */
  const labels = new Map<string, string>()
  const label = (name: string) => labels.get(name) ?? name
  const application = (name: string): InboxOrigin => ({ kind: 'application', label: label(name) })
  // Every row lands on the Plugins shelf of the Store, where a plugin is reloaded, configured or
  // turned off. A manifest name has no `@marketplace`, so it cannot name one plugin's page.
  const openPlugins = () => [recoveryAction('open-store:plugin', 'Open plugins')] as const

  return {
    loaded(owner, outcome) {
      if (outcome.displayName) labels.set(outcome.name, outcome.displayName)
      const subject = ['plugin', outcome.name, 'load', outcome.projectId]
      if (!outcome.error) return conditions.clear(owner, subject)
      conditions.raise(owner, {
        subject,
        severity: 'error',
        title: `Could not load the ${label(outcome.name)} plugin`,
        body: outcome.error,
        origin: application(outcome.name),
        actions: openPlugins(),
      })
    },

    catalogLoaded(owner, projectId, error) {
      // The WHOLE per-run load threw — no plugin's skills or hooks reached this scope's runs, and
      // the only trace was a console line. One condition per scope, settled by the next load.
      const subject = ['plugins', 'load', projectId]
      if (!error) return conditions.clear(owner, subject)
      conditions.raise(owner, {
        subject,
        severity: 'error',
        title: 'Could not load plugins',
        body: ['Runs in this workspace go without plugin skills and hooks.', error].join('\n'),
        origin: { kind: 'application', label: 'Plugins' },
        actions: openPlugins(),
      })
    },

    enabled: (names) =>
      conditions.sweep(userId, ['plugin'], ([name]) => name !== undefined && names.has(name)),

    monitorStarted: (pluginName, monitorName) =>
      conditions.clear(userId, ['plugin', pluginName, 'monitor', monitorName]),

    monitorStopped(pluginName, monitorName, detail) {
      conditions.raise(userId, {
        subject: ['plugin', pluginName, 'monitor', monitorName],
        severity: 'warning',
        title: `The ${label(pluginName)} monitor “${monitorName}” stopped`,
        body: detail,
        origin: application(pluginName),
        actions: openPlugins(),
      })
    },
  }
}

/**
 * The process's plugin conditions, for the seam no dependency graph reaches: the per-run plugin
 * load is built inside the chat runtime, per scope, and cached there. The root registers the
 * recorder here once — the same shape as `observeMcpOAuthSecrets`. Unset (tests, inspection
 * scripts), recording is a no-op.
 */
let observer: Pick<PluginConditions, 'loaded' | 'catalogLoaded'> | undefined

export function observePluginConditions(
  conditions: Pick<PluginConditions, 'loaded' | 'catalogLoaded'> | undefined,
): void {
  observer = conditions
}

export function recordPluginCatalogLoad(userId: string, projectId: string, error?: unknown): void {
  observer?.catalogLoaded(userId, projectId, error === undefined ? undefined : errorMessage(error))
}

export function recordPluginLoad(userId: string, outcome: PluginLoadOutcome): void {
  observer?.loaded(userId, outcome)
}
