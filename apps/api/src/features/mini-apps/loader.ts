import { registerContextToolClasses } from '@localixai/agent'
import { createHash } from 'node:crypto'

import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import { scalarConfig } from '../capabilities/source-repository'
import type { AvailabilityReader } from '../capabilities/availability'
import { errorMessage } from '../../lib/errors'
import { localixWorkspaceDir } from '../../lib/env'
import { freshModuleUrl } from '../../lib/module-url'
import { recordMiniAppLoad } from '../notifications/conditions/mini-apps'
import { buildMiniAppCatalog } from './catalog'
import { resolveMiniAppConfig } from './config'
import { miniAppLoadBlockReason } from './loadable'
import { emptyLoadedMiniApps, type LoadedMiniApps } from './loader-contract'
import type { MiniAppHostServices } from '@localixai/mini-app-sdk/backend'
import { importNativeModule } from './native'
import { makeContext } from './native-context'
import { miniAppProblemReporter, type MiniAppProblemSink } from './problem-reporter'
import {
  capMiniAppToolDescription,
  isAcceptableToolName,
  MINI_APP_TOOL_DESCRIPTION_MAX_CHARS,
} from './tool-policy'

export type { LoadedMiniApps, LoadedMiniAppHook } from './loader-contract'

/** The `${KEY}` tokens of a prompt section, filled from the app's settings. */
const fillSettings = (text: string, config: Record<string, unknown>) =>
  text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key: string) => {
    const value = config[key]
    if (value === undefined) return ''
    return typeof value === 'string' ? value : JSON.stringify(value)
  })

/** What one backend entry's `register(ctx)` produced, kept while its code and settings stand. */
type Imported = Awaited<ReturnType<typeof importNativeModule>>
const imported = new Map<string, { revision: string; result: Imported }>()

/**
 * Run `register(ctx)` once per scope, not once per turn. The context it receives is bound to the
 * scope (user, project, working directory) and to nothing of the turn, so the tools, hooks and
 * memory provider it returned answer the next turn as well; a rebuilt backend or changed settings
 * are a new `revision` and run it again. Only the per-run load is kept: the backend host's load
 * must stay fresh, because unwiring a mini app shuts the instance it was handed down.
 */
async function importOnce(
  key: string | null,
  revision: string,
  entry: string,
  ctx: Parameters<typeof importNativeModule>[1],
): Promise<Imported> {
  const kept = key === null ? undefined : imported.get(key)
  if (kept?.revision === revision) return kept.result
  const result = await importNativeModule(entry, ctx)
  if (key !== null) imported.set(key, { revision, result })
  return result
}

export interface LoadMiniAppsOptions {
  /** What the scope's rules say; a trust gate decides whatever they do not. */
  availability: AvailabilityReader
  /** The `mini-app` rows of `capability_source`. */
  repo: CapabilitySourceRepository
  userId: string
  projectId: string
  cwd: string
  homeDir: string
  logger?: {
    warn: (msg: string, meta?: unknown) => void
    info?: (msg: string, meta?: unknown) => void
  }
  /** The host services a backend's `register(ctx)` receives, bound to each app. */
  hostForMiniApp?: (app: string) => MiniAppHostServices
  host?: MiniAppHostServices
  /** Where an app's problem that names a chat is also drawn (the per-run load). */
  reportProblem?: MiniAppProblemSink
  sessionStorageFor?: (app: string) => NonNullable<MiniAppHostServices['sessionStorage']>
  agentDirectory?: MiniAppHostServices['agents']
  /** The decision model for the per-run load, attributed to each app (the boot load's is in `host`). */
  decisionsFor?: (app: string) => NonNullable<MiniAppHostServices['decisions']>
}

/**
 * Turn the enabled mini apps of one scope into what the runtime consumes: their backends' agent
 * tools, hooks, channels, memory and subsystems, their prompt sections and their guides. A mini
 * app's code is imported only when it may run: a rule allows it, or, where none speaks, it is one
 * Localix ships. A failing app contributes nothing and says why; the others load.
 */
export async function loadEnabledMiniApps(opts: LoadMiniAppsOptions): Promise<LoadedMiniApps> {
  const result = emptyLoadedMiniApps()
  const seenToolNames = new Set<string>()
  const timings: Array<{ name: string; ms: number }> = []
  const startedAt = performance.now()
  const catalog = await buildMiniAppCatalog({
    repo: opts.repo,
    availability: opts.availability,
    userId: opts.userId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    homeDir: opts.homeDir,
  })
  result.awaitingConsent = catalog.awaitingConsent

  for (const { app, state } of catalog.enabled) {
    const summary = {
      name: app.name,
      scope: app.scope,
      description: app.manifest?.description ?? '',
      toolNames: [] as string[],
      error: undefined as string | undefined,
    }
    const finish = () => {
      result.loaded.push(summary)
      recordMiniAppLoad(opts.userId, {
        name: app.name,
        displayName: app.manifest?.displayName,
        projectId: app.scope === 'project' ? app.projectId : '',
        ...(summary.error ? { error: summary.error } : {}),
      })
    }
    const blocked = miniAppLoadBlockReason(app)
    if (blocked || !app.manifest) {
      summary.error = blocked ?? 'The mini app has no readable manifest'
      finish()
      continue
    }

    const config = resolveMiniAppConfig(app.manifest.config, scalarConfig(state?.config))
    const ctx = makeContext(
      app.name,
      app.dir,
      config,
      (message: string) => opts.logger?.warn(`[mini-app:${app.name}] ${message}`),
      opts.cwd,
      opts.userId,
      opts.homeDir,
      opts.hostForMiniApp?.(app.name) ?? opts.host,
      miniAppProblemReporter(opts.userId, opts.reportProblem),
      {
        sessionStorage: opts.sessionStorageFor?.(app.name),
        agents: opts.agentDirectory,
        decisions: opts.decisionsFor?.(app.name),
      },
    )

    // Hashed: the revision is compared and kept, and the settings can hold secrets.
    const settingsRevision = createHash('sha256').update(JSON.stringify(config)).digest('hex')
    const perRun = !opts.host && !opts.hostForMiniApp
    const importStartedAt = performance.now()
    for (const entry of app.backendEntries) {
      const revision = `${freshModuleUrl(entry)}#${settingsRevision}`
      const key = perRun ? [opts.userId, opts.projectId, opts.cwd, app.dir, entry].join('\0') : null
      try {
        const { tools, hooks, channels, memory, backends } = await importOnce(
          key,
          revision,
          entry,
          ctx,
        )
        for (const channel of channels) result.channels.push({ app: app.name, channel, ctx })
        for (const backend of backends) {
          result.backends.push({
            app: app.name,
            projectId: app.projectId,
            backend,
            // The path and mtime it was imported under, and the settings it was given: a rebuilt
            // backend, or one whose settings changed, is a new revision the host wires again.
            revision,
          })
        }
        if (memory) {
          if (result.memory)
            opts.logger?.warn(
              `mini app "${app.name}" memory provider ignored ("${result.memory.app}" is already active)`,
            )
          else result.memory = { app: app.name, provider: memory, ctx }
        }
        for (const tool of tools) {
          if (!isAcceptableToolName(tool.name)) {
            opts.logger?.warn(`mini app "${app.name}" tool "${tool.name}" rejected (reserved name)`)
            continue
          }
          if (seenToolNames.has(tool.name)) {
            opts.logger?.warn(`mini app "${app.name}" tool "${tool.name}" skipped (name taken)`)
            continue
          }
          seenToolNames.add(tool.name)
          const description = capMiniAppToolDescription(tool.description)
          if (description !== tool.description)
            opts.logger?.warn(`mini app "${app.name}" tool "${tool.name}" description capped`, {
              originalChars: tool.description.length,
              maxChars: MINI_APP_TOOL_DESCRIPTION_MAX_CHARS,
            })
          result.tools.push(description === tool.description ? tool : { ...tool, description })
          summary.toolNames.push(tool.name)
        }
        if (hooks) result.hooks.push({ app: app.name, hooks, ctx })
      } catch (error) {
        const message = errorMessage(error)
        summary.error = summary.error ? `${summary.error}; ${message}` : message
        opts.logger?.warn(`mini app "${app.name}" failed to load its backend from ${entry}`, {
          error: message,
        })
      }
    }
    if (app.backendEntries.length > 0)
      timings.push({ name: app.name, ms: Math.round(performance.now() - importStartedAt) })

    for (const section of app.promptSections)
      result.promptSections.push({
        app: app.name,
        title: section.title,
        content: fillSettings(section.content, config),
      })
    if (app.guide) {
      result.guides.push({
        app: app.name,
        file: app.guide,
        ...(app.pages ? { pages: app.pages } : {}),
      })
    }
    finish()
  }

  // Tell the context machinery which mini app tools classify their own results, so compression
  // treats them right without the core naming any of them.
  const classes: Record<'readResult' | 'mutate' | 'patch' | 'nonidempotent', string[]> = {
    readResult: [],
    mutate: [],
    patch: [],
    nonidempotent: [],
  }
  for (const tool of result.tools) if (tool.contextClass) classes[tool.contextClass].push(tool.name)
  registerContextToolClasses(classes)

  if (opts.logger?.info && timings.length > 0)
    opts.logger.info('mini apps loaded', {
      event: 'mini_apps.loaded',
      apps: timings.length,
      importMs: timings.reduce((total, entry) => total + entry.ms, 0),
      totalMs: Math.round(performance.now() - startedAt),
      slowest: [...timings].sort((a, b) => b.ms - a.ms).slice(0, 5),
    })
  return result
}

/**
 * The backend load for the process-global backend host: the enabled mini apps of one scope and
 * their `register()` subsystems. Every other contribution is loaded per run.
 */
export async function loadMiniAppBackends(
  opts: Omit<LoadMiniAppsOptions, 'projectId' | 'cwd'> & { projectId?: string; cwd?: string },
): Promise<Pick<LoadedMiniApps, 'backends' | 'loaded'>> {
  const loaded = await loadEnabledMiniApps({
    ...opts,
    projectId: opts.projectId ?? '',
    cwd: opts.cwd ?? localixWorkspaceDir(),
  })
  return { backends: loaded.backends, loaded: loaded.loaded }
}
