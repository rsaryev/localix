import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { registerContextToolClasses } from '@localixai/agent'

import { type CapabilitySourceRepository, scalarConfig } from '../capabilities/source-repository'
import type { AvailabilityReader } from '../capabilities/availability'
import { errorMessage } from '../../lib/errors'
import { localixWorkspaceDir } from '../../lib/env'
import { freshModuleUrl } from '../../lib/module-url'
import { readSkillsFromRoot } from '../agent-core/skill-discovery'
import { pluginLoadBlockReason } from './loadable'
import { buildPluginCatalog } from './catalog'
import { buildLoadedAgent, emptyLoadedPlugins, type LoadedPlugins } from './loader-contract'
import { resolvePluginConfig } from './config'
import {
  makeContext,
  importNativeModule,
  type MiniAppHostServices,
  type MiniAppProblemSink,
} from './native'
import { miniAppProblemReporter } from './problem-reporter'
import { recordPluginLoad } from '../notifications/conditions/plugins'
import {
  capMiniAppToolDescription,
  isAcceptableToolName,
  MINI_APP_TOOL_DESCRIPTION_MAX_CHARS,
} from './tool-policy'
import { buildMcpRecords } from './mcp'
import {
  makePluginSubstituter,
  appendPluginRuntimeDeclarations,
} from './loader-runtime-declarations'

export type { LoadedMiniAppHook, LoadedPluginMonitor, LoadedPlugins } from './loader-contract'

/**
 * Plugin loader — turns enabled, discovered plugins into things the agent runtime
 * already knows how to consume: AgentTools (native, in-process), MCP server records
 * (merged into the per-turn gather), skills (merged into the skill list), and
 * lifecycle hooks. The enable-state in the DB is the trust gate: a plugin's native
 * JS is imported ONLY when the user has explicitly enabled it, so dropping a
 * directory into `~/.localix/plugins` never runs code on its own.
 *
 * Discovery + state + the enable rule live in [[catalog]]; native-module import in
 * [[native]]; MCP synthesis in [[mcp]]; config resolution in [[config]]; tool-name
 * policy in [[tool-policy]]. This file is just the orchestration that fans those out.
 */

export async function loadEnabledPlugins(opts: {
  /** What the scope's rules say; a trust gate decides whatever they do not. */
  availability: AvailabilityReader
  repo: CapabilitySourceRepository
  userId: string
  projectId: string
  cwd: string
  /** The user's home (see `discoverPlugins`); required, so no caller stages into a home by default. */
  homeDir: string
  now?: () => string
  logger?: {
    warn: (msg: string, meta?: unknown) => void
    /** Optional — when present, the load emits its per-plugin timing summary here. */
    info?: (msg: string, meta?: unknown) => void
  }
  /** Generic host-service seam for backend subsystems (see {@link MiniAppHostServices}).
   *  Threaded into each plugin's `register(ctx)` context. Passed only on the boot-time
   *  backend load; undefined for the ordinary per-run load. */
  host?: MiniAppHostServices
  /** Preferred authority seam: binds audit/use capability to the plugin identity. */
  hostForMiniApp?: (pluginName: string) => MiniAppHostServices
  /** Where a plugin's problem that names a chat is ALSO drawn. Supplied by the per-RUN load,
   *  the only caller with a session firehose behind it. Every load records the problem in the
   *  Event Center regardless (`problem-reporter.ts`), so `ctx.reportProblem` is always present. */
  reportProblem?: MiniAppProblemSink
  /** Session storage for the per-RUN load, bound to each plugin's name — the boot load gets it
   *  through `hostForMiniApp` instead, so tools and routes resolve the same folder. */
  sessionStorageFor?: (pluginName: string) => NonNullable<MiniAppHostServices['sessionStorage']>
  /** The agent directory for the per-RUN load — the boot load gets it through `hostForMiniApp`. */
  agentDirectory?: MiniAppHostServices['agents']
}): Promise<LoadedPlugins> {
  const now = opts.now ?? (() => new Date().toISOString())
  const result = emptyLoadedPlugins()
  const seenToolNames = new Set<string>()
  /**
   * What importing and `register()`-ing each plugin actually costs, in ms.
   *
   * Kept out of `result.loaded` on purpose: that summary feeds the prompt's plugin
   * section, and a timing number has no business in the model's context. This is a
   * diagnostic, emitted once per load and only when the caller passes a logger that
   * takes `info` — the boot hosts do, the per-run load does not.
   *
   * It exists because "the plugin load got faster" was not a claim anyone could check:
   * `scripts/startup-budget.ts` reads the runtime log, and the runtime log had no line
   * about plugin loading at all.
   */
  const timings: Array<{ name: string; ms: number }> = []
  const loadStartedAt = performance.now()

  const catalog = await buildPluginCatalog({
    repo: opts.repo,
    availability: opts.availability,
    userId: opts.userId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    homeDir: opts.homeDir,
  })
  const catalogMs = performance.now() - loadStartedAt
  result.awaitingConsent = catalog.awaitingConsent

  for (const { plugin, state } of catalog.enabled) {
    const summary = {
      name: plugin.manifest.name,
      scope: plugin.scope,
      description: plugin.manifest.description,
      toolNames: [] as string[],
      skills: plugin.provides.skills,
      mcpServers: plugin.provides.mcpServers,
      binDir: undefined as string | undefined,
      error: plugin.error,
    }
    // Every load answers for each plugin in the Event Center too: an error opens (or keeps) a
    // standing condition for this plugin in this scope, a clean load settles it. A recovered
    // manifest's warning alone is not a failed load — the plugin runs.
    const finish = () => {
      result.loaded.push(summary)
      const error =
        plugin.manifestRecovered && summary.error === plugin.error ? undefined : summary.error
      recordPluginLoad(opts.userId, {
        name: plugin.manifest.name,
        displayName: plugin.manifest.displayName,
        // A global plugin is projected into every scope; it is one plugin, so one row.
        projectId: plugin.scope === 'project' ? plugin.projectId : '',
        ...(error ? { error } : {}),
      })
    }

    // Refuse to RUN a plugin this host cannot satisfy: a fatal manifest error (broken JSON, invalid
    // name…) or an `apiVersion` newer than this host implements. The second used to be reported in
    // Settings and enforced nowhere, so a plugin built against a future SDK was imported anyway and
    // failed in whatever way its missing contract happened to fail. `summary.error` carries the
    // reason, which the plugin row already renders — a plugin that contributes nothing must say why.
    const blocked = pluginLoadBlockReason(plugin)
    if (blocked) {
      summary.error = blocked
      finish()
      continue
    }

    // Resolve config + build context only for plugins that successfully loaded their manifest.
    const config = resolvePluginConfig(plugin.manifest, scalarConfig(state?.config))
    const ctx = makeContext(
      plugin.manifest.name,
      plugin.dir,
      config,
      (message: string) => opts.logger?.warn(`[plugin:${plugin.manifest.name}] ${message}`),
      opts.cwd,
      opts.userId,
      opts.homeDir,
      opts.hostForMiniApp?.(plugin.manifest.name) ?? opts.host,
      miniAppProblemReporter(opts.userId, opts.reportProblem),
      opts.sessionStorageFor?.(plugin.manifest.name),
      opts.agentDirectory,
    )

    // Per-plugin text substituter — created once, reused for agents/skills/promptSections.
    const subst = makePluginSubstituter(
      plugin.dir,
      plugin.manifest.name,
      config,
      plugin.manifest,
      opts.cwd || '',
      opts.homeDir,
    )

    // ---- Executable `bin/` dir (Claude Code convention) -------------------
    // An enabled plugin's `<dir>/bin` goes onto the bash tool's PATH so its bundled
    // CLIs (referenced by bare name in commands/skills) resolve. Directory
    // convention only — no manifest field. Enablement gate already applied here.
    const binDir = join(plugin.dir, 'bin')
    if (existsSync(binDir)) {
      result.binDirs.push(binDir)
      summary.binDir = binDir
    }

    // ---- Native tools + hooks ---------------------------------------------
    // ONE path for every plugin. There used to be a second: a plugin could mirror its
    // whole `register()` output into the manifest (`contributes` / `experimental.
    // nativeContributions`) and get schema-faithful stubs plus a deferred import. The
    // idea was right and its coverage was not — the mirror had to be exact and complete,
    // and any backend carrying a resource/search/context provider was rejected outright,
    // which is every workbench plugin we ship. Three of thirteen adopted it, all of them
    // the smallest, together saving under a millisecond of the measured 167 ms of import.
    // A second loading path that no load-bearing plugin can take is a second set of
    // behaviours to test and document for nothing, so this is the only one now.
    const nativeStartedAt = performance.now()
    for (const entry of plugin.entrypoints.toolEntries) {
      try {
        const { tools, hooks, channels, memory, backends } = await importNativeModule(entry, ctx)
        for (const channel of channels) {
          result.channels.push({ pluginName: plugin.manifest.name, channel, ctx })
        }
        // Process-global backend subsystems — collected for the boot-time consumer.
        for (const backend of backends) {
          result.backends.push({
            pluginName: plugin.manifest.name,
            projectId: plugin.projectId,
            backend,
            // The URL the module was imported under: path + mtime, so a rebuilt or re-staged
            // backend is a new revision and an untouched one is the same.
            revision: freshModuleUrl(entry),
          })
        }
        if (memory) {
          // One active memory backend at a time — first enabled plugin wins.
          if (result.memory) {
            opts.logger?.warn(
              `plugin "${plugin.manifest.name}" memory provider ignored ("${result.memory.pluginName}" is already active)`,
            )
          } else {
            result.memory = { pluginName: plugin.manifest.name, provider: memory, ctx }
          }
        }
        for (const tool of tools) {
          if (!isAcceptableToolName(tool.name)) {
            opts.logger?.warn(
              `plugin "${plugin.manifest.name}" tool "${tool.name}" rejected (reserved/invalid name)`,
            )
            continue
          }
          if (seenToolNames.has(tool.name)) {
            opts.logger?.warn(
              `plugin "${plugin.manifest.name}" tool "${tool.name}" skipped (name already registered)`,
            )
            continue
          }
          seenToolNames.add(tool.name)
          const description = capMiniAppToolDescription(tool.description)
          if (description !== tool.description) {
            opts.logger?.warn(
              `plugin "${plugin.manifest.name}" tool "${tool.name}" description capped for model context`,
              {
                originalChars: tool.description.length,
                maxChars: MINI_APP_TOOL_DESCRIPTION_MAX_CHARS,
              },
            )
          }
          result.tools.push(description === tool.description ? tool : { ...tool, description })
          summary.toolNames.push(tool.name)
        }
        if (hooks) result.hooks.push({ pluginName: plugin.manifest.name, hooks, ctx })
      } catch (err) {
        const message = errorMessage(err)
        summary.error = summary.error ? `${summary.error}; ${message}` : message
        opts.logger?.warn(`plugin "${plugin.manifest.name}" failed to load tools from ${entry}`, {
          error: message,
        })
      }
    }
    if (plugin.entrypoints.toolEntries.length > 0) {
      timings.push({
        name: plugin.manifest.name,
        ms: Math.round(performance.now() - nativeStartedAt),
      })
    }

    // ---- MCP servers ------------------------------------------------------
    result.mcpServers.push(
      ...buildMcpRecords(plugin, config, opts.userId, now(), opts.homeDir, opts.logger, {
        projectDir: opts.cwd || undefined,
      }),
    )

    // ---- Prompt sections (declarative — no code import) --------------------
    for (const section of plugin.manifest.promptSections ?? []) {
      result.promptSections.push({
        pluginName: plugin.manifest.name,
        title: section.title,
        content: subst(section.content),
      })
    }

    // ---- Custom worker roles (sub-agents — manifest data + CC files) --------
    for (const agent of plugin.agents) {
      result.agents.push(buildLoadedAgent(plugin.manifest.name, agent, subst))
    }

    // ---- Skills -----------------------------------------------------------
    for (const skillDir of plugin.entrypoints.skillDirs) {
      const scope = plugin.scope === 'project' ? 'project' : 'global'
      try {
        // Substitute plugin path vars + non-sensitive config only when a selected
        // skill body is first read; spreading each skill here used to defeat the
        // metadata-only discovery boundary by invoking every lazy content accessor.
        const skills = await readSkillsFromRoot(skillDir, scope, opts.logger, subst)
        for (const skill of skills) {
          // Descriptions are roster metadata and remain eagerly substituted.
          if (skill.description) skill.description = subst(skill.description)
          skill.pluginName = plugin.manifest.name
          skill.pluginRoot = plugin.dir
          result.skills.push(skill)
        }
      } catch (err) {
        // Same treatment as the tools branch above: a plugin that contributes ZERO skills while
        // reporting itself healthy is indistinguishable from one that declares no skills, and the
        // skill roster is the only place the absence would ever show.
        const message = errorMessage(err)
        summary.error = summary.error ? `${summary.error}; ${message}` : message
        opts.logger?.warn(
          `plugin "${plugin.manifest.name}" failed to read skills from ${skillDir}`,
          { error: message },
        )
      }
    }

    appendPluginRuntimeDeclarations({ plugin, config, subst, result, summary, opts })

    finish()
  }

  // Teach the VBC context machinery about plugin tools that classify their own
  // results/args, so compression treats them right WITHOUT core hardcoding tool
  // names.
  // Generic + idempotent (same idiom as the `background` flag).
  const ctxClasses: Record<'readResult' | 'mutate' | 'patch' | 'nonidempotent', string[]> = {
    readResult: [],
    mutate: [],
    patch: [],
    nonidempotent: [],
  }
  for (const tool of result.tools) {
    if (tool.contextClass) ctxClasses[tool.contextClass].push(tool.name)
  }
  registerContextToolClasses(ctxClasses)

  // One structured line per load, slowest plugin first — the baseline any later change
  // to this pipeline is measured against. `scripts/startup-budget.ts` reads this log.
  if (opts.logger?.info && timings.length > 0) {
    const nativeMs = timings.reduce((total, entry) => total + entry.ms, 0)
    opts.logger.info('plugins loaded', {
      event: 'plugins.loaded',
      plugins: timings.length,
      catalogMs: Math.round(catalogMs),
      nativeMs,
      totalMs: Math.round(performance.now() - loadStartedAt),
      slowest: [...timings].sort((a, b) => b.ms - a.ms).slice(0, 5),
    })
  }

  return result
}

/**
 * BACKEND load: discover enabled plugins in one exact scope and collect their `register()`
 * backend contributions for the plugin backend HOST (backend-host.ts) — the live
 * reconciler that wires each into the subsystem registry (routes/resource/search/
 * shutdown) and the WS-frame registry. Boot's first `reconcile()` calls this before
 * `createApp`; every later plugin toggle calls it again and the host diffs the
 * result against what is wired, per `pluginName` — that is why each entry carries
 * the owning plugin's name.
 *
 * Thin wrapper over [[loadEnabledPlugins]] (same discovery + trust gate + per-plugin
 * failure isolation) that returns the `backends` slice and the per-plugin summary — every
 * other contribution (tools/hooks/skills/MCP) is still loaded per-run where it belongs.
 * The summary rides along for the one host service that needs to know what a plugin
 * registered: a plugin's wake may name only its own tools (`plugin-wake.ts`).
 * The process-global host composes this function across every scope and wires a
 * backend while at least one scope enables its owning plugin.
 */
export async function loadMiniAppBackends(opts: {
  repo: CapabilitySourceRepository
  /** What the scope's rules say; a trust gate decides whatever they do not. */
  availability: AvailabilityReader
  userId: string
  projectId?: string
  cwd?: string
  /** The user's home (see `discoverPlugins`). */
  homeDir: string
  logger?: {
    warn: (msg: string, meta?: unknown) => void
    /** Optional — receives the load's `plugins.loaded` timing summary. */
    info?: (msg: string, meta?: unknown) => void
  }
  /** Generic host-service seam threaded into each backend plugin's `register(ctx)` — the
   *  boot-time authority for capabilities a subsystem service needs (e.g. secret
   *  resolution). See {@link MiniAppHostServices}. */
  host?: MiniAppHostServices
  hostForMiniApp?: (pluginName: string) => MiniAppHostServices
}): Promise<Pick<LoadedPlugins, 'backends' | 'loaded'>> {
  const loaded = await loadEnabledPlugins({
    repo: opts.repo,
    availability: opts.availability,
    userId: opts.userId,
    projectId: opts.projectId ?? '',
    cwd: opts.cwd ?? localixWorkspaceDir(),
    homeDir: opts.homeDir,
    logger: opts.logger,
    host: opts.host,
    hostForMiniApp: opts.hostForMiniApp,
  })
  return { backends: loaded.backends, loaded: loaded.loaded }
}
