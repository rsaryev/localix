import type { MiniAppProblem } from '@localixai/mini-app-sdk/backend'

import { settingsEntityAnchor } from '@localixai/mini-app-sdk/navigation'

import { errorMessage } from '../../../lib/errors'
import { recoveryAction } from '../recovery'
import type { BundledStagingFailure } from '../../plugins/bundled-install'
import type { InboxOrigin } from '../contracts'
import { createConditions, headline, type ConditionJournal } from './condition'

/**
 * WHAT IS WRONG WITH A PLUGIN, as standing conditions — one subject per part that can break.
 *
 * Every one of these was a `logger.warn` and nothing else: a plugin whose import threw, a backend
 * rejected for an un-namespaced id, a channel whose receive loop crashed, a monitor that died, and a
 * plugin's own `ctx.reportProblem` from a load with no chat behind it. The plugin row in Settings
 * showed some of them to a person who happened to open Settings; none reached the Event Center. Each
 * is now a subject under `plugin:<name>:`, so disabling the plugin retires all of them at once
 * (`sweep`), and each part clears when it works again:
 *
 *   plugin:<name>:load:<projectId>:     the load reported an error for that scope ('' = global)
 *   plugin:<name>:backend:              the backend host rejected one of its subsystems
 *   plugin:<name>:channel:<channel>:    a channel's receive loop crashed
 *   plugin:<name>:monitor:<monitor>:    a `when: always` monitor stopped running
 *   plugin:<name>:problem:<source>:     the plugin reported a problem itself
 *   plugins:reconcile:                  the backend host could not apply the enabled set at all
 *   plugins:build:<name>:               a first-party plugin's current source did not build or
 *                                       install, so it runs its last good copy or not at all
 *
 * `plugins:` is its own root, not a plugin named "reconcile": `condition:plugin:` never matches it.
 * A build failure lives there too, because a plugin that never built is not ENABLED, and the
 * `enabled` sweep would settle its row the moment it was raised.
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
  /** A plugin's `ctx.reportProblem`. */
  problem(userId: string, pluginName: string, problem: MiniAppProblem): void
  /** The per-run load of a scope's plugins as a whole: `error` when it threw. */
  catalogLoaded(userId: string, projectId: string, error?: string): void
  backendProblems(pluginName: string, problems: readonly string[]): void
  /** The complete set of first-party plugins not running their current source: rows about any
   *  other plugin are settled as fixed. */
  stagingFailed(failures: readonly BundledStagingFailure[]): Promise<void>
  reconciled(error?: string): void
  channelStarted(pluginName: string, channelName: string): void
  channelCrashed(pluginName: string, channelName: string, error: string): void
  monitorStarted(pluginName: string, monitorName: string): void
  monitorStopped(pluginName: string, monitorName: string, detail: string): void
}

/** `userId` is who owns the process-wide hosts (backend, channels, monitors): the default user. */
export function createPluginConditions(
  journal: ConditionJournal,
  userId: string,
): PluginConditions {
  const conditions = createConditions(journal)
  /** Display names learned from loads, for the hosts that only know the manifest name. */
  const labels = new Map<string, string>()
  const label = (name: string) => labels.get(name) ?? name
  const application = (name: string): InboxOrigin => ({ kind: 'application', label: label(name) })
  // Every row lands on the plugin's own Settings row — where it is reloaded, configured or
  // turned off — or, for the plugin set as a whole, the Plugins tab.
  const openPlugin = (name: string) =>
    [
      recoveryAction(
        `open-settings:plugins/${settingsEntityAnchor('plugin', name)}`,
        'Open plugin settings',
      ),
    ] as const
  const openPlugins = () => [recoveryAction('open-settings:plugins', 'Open plugins')] as const

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
        actions: openPlugin(outcome.name),
      })
    },

    catalogLoaded(owner, projectId, error) {
      // The WHOLE per-run load threw — no plugin's tools, skills or hooks reached this scope's
      // runs, and the only trace was a console line. One condition per scope, settled by the next
      // load that completes.
      const subject = ['plugins', 'load', projectId]
      if (!error) return conditions.clear(owner, subject)
      conditions.raise(owner, {
        subject,
        severity: 'error',
        title: 'Could not load plugins',
        body: ['Runs in this workspace go without plugin tools, skills and hooks.', error].join(
          '\n',
        ),
        origin: { kind: 'application', label: 'Plugins' },
        actions: openPlugins(),
      })
    },

    enabled: (names) =>
      conditions.sweep(userId, ['plugin'], ([name]) => name !== undefined && names.has(name)),

    problem(owner, pluginName, problem) {
      const source = problem.source ?? ''
      conditions.raise(owner, {
        subject: ['plugin', pluginName, 'problem', source],
        problem: problem.message,
        // A warning, like the transcript line: the plugin still runs; something it does is failing.
        severity: 'warning',
        title: headline(problem.message),
        body: [source && `${label(pluginName)} · ${source}`, problem.detail]
          .filter(Boolean)
          .join('\n'),
        origin: problem.sessionId
          ? {
              kind: 'session',
              sessionId: problem.sessionId,
              projectId: null,
              label: label(pluginName),
            }
          : application(pluginName),
        actions: openPlugin(pluginName),
      })
    },

    backendProblems(pluginName, problems) {
      const subject = ['plugin', pluginName, 'backend']
      if (problems.length === 0) return conditions.clear(userId, subject)
      conditions.raise(userId, {
        subject,
        severity: 'error',
        title: `Could not start the ${label(pluginName)} plugin backend`,
        body: problems.join('\n'),
        origin: application(pluginName),
        actions: openPlugin(pluginName),
      })
    },

    async stagingFailed(failures) {
      for (const failure of failures) {
        conditions.raise(userId, {
          subject: ['plugins', 'build', failure.name],
          problem: failure.reason,
          // Running the copy that last built is degraded, not broken; no copy at all is broken.
          severity: failure.lastGoodCopy ? 'warning' : 'error',
          title: failure.lastGoodCopy
            ? `The ${label(failure.name)} plugin is running its last successful build`
            : `The ${label(failure.name)} plugin did not build`,
          body: [
            failure.reason,
            failure.lastGoodCopy
              ? 'Its current source failed; the copy from the last build that worked stays installed until it builds again.'
              : 'It is unavailable until its source builds.',
          ].join('\n'),
          origin: { kind: 'application', label: 'Plugins' },
          actions: openPlugin(failure.name),
        })
      }
      const failing = new Set(failures.map((failure) => failure.name))
      await conditions.sweep(
        userId,
        ['plugins', 'build'],
        ([name]) => name !== undefined && failing.has(name),
        'fixed',
      )
    },

    reconciled(error) {
      const subject = ['plugins', 'reconcile']
      if (!error) return conditions.clear(userId, subject)
      conditions.raise(userId, {
        subject,
        severity: 'error',
        title: 'Could not apply plugin changes',
        body: error,
        origin: { kind: 'application', label: 'Plugins' },
        actions: openPlugins(),
      })
    },

    channelStarted: (pluginName, channelName) =>
      conditions.clear(userId, ['plugin', pluginName, 'channel', channelName]),

    channelCrashed(pluginName, channelName, error) {
      conditions.raise(userId, {
        subject: ['plugin', pluginName, 'channel', channelName],
        // A warning like a stopped monitor: one part of an integration stopped while the plugin
        // still runs — degraded. An error is kept for a plugin that cannot be used at all.
        severity: 'warning',
        title: `The ${label(pluginName)} channel “${channelName}” stopped`,
        body: error,
        origin: application(pluginName),
        actions: openPlugin(pluginName),
      })
    },

    monitorStarted: (pluginName, monitorName) =>
      conditions.clear(userId, ['plugin', pluginName, 'monitor', monitorName]),

    monitorStopped(pluginName, monitorName, detail) {
      conditions.raise(userId, {
        subject: ['plugin', pluginName, 'monitor', monitorName],
        severity: 'warning',
        title: `The ${label(pluginName)} monitor “${monitorName}” stopped`,
        body: detail,
        origin: application(pluginName),
        actions: openPlugin(pluginName),
      })
    },
  }
}

/**
 * The process's plugin conditions, for the two seams no dependency graph reaches.
 *
 * A plugin CONTEXT (`native.ts` `makeContext`) and the per-run plugin load are built inside the
 * chat runtime, per scope, and cached there; nothing the composition root builds is handed to
 * them. Threading a journal through that runtime for one fire-and-forget call would widen a
 * surface another owner maintains, so the root registers the recorder here once — the same shape
 * as `observeMcpOAuthSecrets`. Unset (tests, inspection scripts), recording is a no-op.
 */
let observer: Pick<PluginConditions, 'loaded' | 'problem' | 'catalogLoaded'> | undefined

export function observePluginConditions(
  conditions: Pick<PluginConditions, 'loaded' | 'problem' | 'catalogLoaded'> | undefined,
): void {
  observer = conditions
}

export function recordPluginCatalogLoad(userId: string, projectId: string, error?: unknown): void {
  observer?.catalogLoaded(userId, projectId, error === undefined ? undefined : errorMessage(error))
}

export function recordPluginLoad(userId: string, outcome: PluginLoadOutcome): void {
  observer?.loaded(userId, outcome)
}

export function recordPluginProblem(
  userId: string,
  pluginName: string,
  problem: MiniAppProblem,
): void {
  observer?.problem(userId, pluginName, problem)
}
