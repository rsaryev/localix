import type { MiniAppProblem } from '@localixai/mini-app-sdk/backend'

import { errorMessage } from '../../../lib/errors'
import { recoveryAction } from '../recovery'
import type { BundledStagingFailure } from '../../mini-apps/bundled-install'
import type { InboxOrigin } from '../contracts'
import { createConditions, headline, type ConditionJournal } from './condition'

/**
 * WHAT IS WRONG WITH A MINI APP, as standing conditions — one subject per part that can break.
 *
 * Each is a subject under `mini-app:<name>:`, so an app no scope enables any more retires all of
 * them at once (`enabled`), and each part clears when it works again:
 *
 *   mini-app:<name>:load:<projectId>:   its backend failed to load for that scope ('' = global)
 *   mini-app:<name>:backend:            the backend host rejected one of its subsystems
 *   mini-app:<name>:channel:<channel>:  a channel's receive loop crashed
 *   mini-app:<name>:problem:<source>:   the app reported a problem itself (`ctx.reportProblem`)
 *   mini-apps:load:<projectId>:         the per-run load of a scope's mini apps threw
 *   mini-apps:reconcile:                the backend host could not apply the enabled set at all
 *   mini-apps:build:<name>:             a first-party app's current source did not build or
 *                                       install, so it runs its last good copy or not at all
 *
 * `mini-apps:` is its own root, not an app named "reconcile". A build failure lives there too,
 * because an app that never built is not ENABLED, and the `enabled` sweep would settle its row the
 * moment it was raised. A Claude Code plugin's conditions are `conditions/plugins.ts`.
 */

export interface MiniAppLoadOutcome {
  name: string
  displayName?: string
  /** '' for a global app, else the project whose catalog it came from. */
  projectId: string
  error?: string
}

export interface MiniAppConditions {
  /** One app's load finished, with or without an error. */
  loaded(userId: string, outcome: MiniAppLoadOutcome): void
  /** The enabled set, across every scope: rows about any other app are retired. */
  enabled(names: ReadonlySet<string>): Promise<void>
  /** An app's `ctx.reportProblem`. */
  problem(userId: string, app: string, problem: MiniAppProblem): void
  /** The per-run load of a scope's mini apps as a whole: `error` when it threw. */
  catalogLoaded(userId: string, projectId: string, error?: string): void
  backendProblems(app: string, problems: readonly string[]): void
  /** The complete set of first-party apps not running their current source: rows about any
   *  other app are settled as fixed. */
  stagingFailed(failures: readonly BundledStagingFailure[]): Promise<void>
  reconciled(error?: string): void
  channelStarted(app: string, channelName: string): void
  channelCrashed(app: string, channelName: string, error: string): void
}

/** `userId` is who owns the process-wide hosts (backend, channels): the default user. */
export function createMiniAppConditions(
  journal: ConditionJournal,
  userId: string,
): MiniAppConditions {
  const conditions = createConditions(journal)
  /** Display names learned from loads, for the hosts that only know the manifest name. */
  const labels = new Map<string, string>()
  const label = (name: string) => labels.get(name) ?? name
  const application = (name: string): InboxOrigin => ({ kind: 'application', label: label(name) })
  // Every row lands on the app's own Store page — where it is configured or turned off — or,
  // for the set as a whole, the Mini apps shelf.
  const openApp = (name: string) =>
    [recoveryAction(`open-store:mini-app/${name}`, 'Open mini app')] as const
  const openApps = () => [recoveryAction('open-store:mini-app', 'Open mini apps')] as const
  const MINI_APPS = { kind: 'application', label: 'Mini apps' } as const

  return {
    loaded(owner, outcome) {
      if (outcome.displayName) labels.set(outcome.name, outcome.displayName)
      const subject = ['mini-app', outcome.name, 'load', outcome.projectId]
      if (!outcome.error) return conditions.clear(owner, subject)
      conditions.raise(owner, {
        subject,
        severity: 'error',
        title: `Could not load the ${label(outcome.name)} mini app`,
        body: outcome.error,
        origin: application(outcome.name),
        actions: openApp(outcome.name),
      })
    },

    catalogLoaded(owner, projectId, error) {
      const subject = ['mini-apps', 'load', projectId]
      if (!error) return conditions.clear(owner, subject)
      conditions.raise(owner, {
        subject,
        severity: 'error',
        title: 'Could not load mini apps',
        body: ['Runs in this workspace go without mini app tools and hooks.', error].join('\n'),
        origin: MINI_APPS,
        actions: openApps(),
      })
    },

    enabled: (names) =>
      conditions.sweep(userId, ['mini-app'], ([name]) => name !== undefined && names.has(name)),

    problem(owner, app, problem) {
      const source = problem.source ?? ''
      conditions.raise(owner, {
        subject: ['mini-app', app, 'problem', source],
        problem: problem.message,
        // A warning, like the transcript line: the app still runs; something it does is failing.
        severity: 'warning',
        title: headline(problem.message),
        body: [source && `${label(app)} · ${source}`, problem.detail].filter(Boolean).join('\n'),
        origin: problem.sessionId
          ? { kind: 'session', sessionId: problem.sessionId, projectId: null, label: label(app) }
          : application(app),
        actions: openApp(app),
      })
    },

    backendProblems(app, problems) {
      const subject = ['mini-app', app, 'backend']
      if (problems.length === 0) return conditions.clear(userId, subject)
      conditions.raise(userId, {
        subject,
        severity: 'error',
        title: `Could not start the ${label(app)} mini app backend`,
        body: problems.join('\n'),
        origin: application(app),
        actions: openApp(app),
      })
    },

    async stagingFailed(failures) {
      for (const failure of failures) {
        conditions.raise(userId, {
          subject: ['mini-apps', 'build', failure.name],
          problem: failure.reason,
          // Running the copy that last built is degraded, not broken; no copy at all is broken.
          severity: failure.lastGoodCopy ? 'warning' : 'error',
          title: failure.lastGoodCopy
            ? `The ${label(failure.name)} mini app is running its last successful build`
            : `The ${label(failure.name)} mini app did not build`,
          body: [
            failure.reason,
            failure.lastGoodCopy
              ? 'Its current source failed; the copy from the last build that worked stays installed until it builds again.'
              : 'It is unavailable until its source builds.',
          ].join('\n'),
          origin: MINI_APPS,
          actions: openApp(failure.name),
        })
      }
      const failing = new Set(failures.map((failure) => failure.name))
      await conditions.sweep(
        userId,
        ['mini-apps', 'build'],
        ([name]) => name !== undefined && failing.has(name),
        'fixed',
      )
    },

    reconciled(error) {
      const subject = ['mini-apps', 'reconcile']
      if (!error) return conditions.clear(userId, subject)
      conditions.raise(userId, {
        subject,
        severity: 'error',
        title: 'Could not apply mini app changes',
        body: error,
        origin: MINI_APPS,
        actions: openApps(),
      })
    },

    channelStarted: (app, channelName) =>
      conditions.clear(userId, ['mini-app', app, 'channel', channelName]),

    channelCrashed(app, channelName, error) {
      conditions.raise(userId, {
        subject: ['mini-app', app, 'channel', channelName],
        // A warning: one part of an integration stopped while the app still runs — degraded.
        severity: 'warning',
        title: `The ${label(app)} channel “${channelName}” stopped`,
        body: error,
        origin: application(app),
        actions: openApp(app),
      })
    },
  }
}

/**
 * The process's mini app conditions, for the two seams no dependency graph reaches: an app's
 * CONTEXT (`mini-apps/native.ts` `makeContext`) and the per-run load are built inside the chat
 * runtime, per scope. The root registers the recorder here once. Unset (tests, inspection
 * scripts), recording is a no-op.
 */
let observer: Pick<MiniAppConditions, 'loaded' | 'problem' | 'catalogLoaded'> | undefined

export function observeMiniAppConditions(
  conditions: Pick<MiniAppConditions, 'loaded' | 'problem' | 'catalogLoaded'> | undefined,
): void {
  observer = conditions
}

export function recordMiniAppCatalogLoad(userId: string, projectId: string, error?: unknown): void {
  observer?.catalogLoaded(userId, projectId, error === undefined ? undefined : errorMessage(error))
}

export function recordMiniAppLoad(userId: string, outcome: MiniAppLoadOutcome): void {
  observer?.loaded(userId, outcome)
}

export function recordMiniAppProblem(userId: string, app: string, problem: MiniAppProblem): void {
  observer?.problem(userId, app, problem)
}
