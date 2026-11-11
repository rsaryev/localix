import { existsSync } from 'node:fs'
import { pluginIdOf } from './plugin-data-id'
import { join } from 'node:path'

import { type CapabilitySourceRepository, scalarConfig } from '../capabilities/source-repository'
import type { AvailabilityReader } from '../capabilities/availability'
import { pluginLoadBlockReason } from './load-block'
import { buildPluginCatalog } from './catalog'
import { catalogMcpServers, kitPluginsOf } from './catalog-kit'
import type { LocalixPluginHost } from './kit'
import { emptyLoadedPlugins, type LoadedPlugins } from './loader-contract'
import { resolvePluginConfig } from './config'
import { recordPluginLoad } from '../notifications/conditions/plugins'
import { buildMcpRecords } from './mcp'
import {
  makePluginSubstituter,
  appendPluginRuntimeDeclarations,
} from './loader-runtime-declarations'

export type { LoadedPlugins } from './loader-contract'

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
  /** The process's plugin host: the kit resolves the plugins' MCP servers in a session of it. */
  pluginHost: LocalixPluginHost
  now?: () => string
  logger?: {
    warn: (msg: string, meta?: unknown) => void
    /** Optional — when present, the load emits its per-plugin timing summary here. */
    info?: (msg: string, meta?: unknown) => void
  }
}): Promise<LoadedPlugins> {
  const now = opts.now ?? (() => new Date().toISOString())
  const result = emptyLoadedPlugins()

  const catalog = await buildPluginCatalog({
    repo: opts.repo,
    availability: opts.availability,
    userId: opts.userId,
    projectId: opts.projectId,
    cwd: opts.cwd,
    homeDir: opts.homeDir,
  })
  result.awaitingConsent = catalog.awaitingConsent
  result.kitPlugins = kitPluginsOf(catalog)
  const mcp = await catalogMcpServers(opts.pluginHost, catalog, {
    cwd: opts.cwd || opts.homeDir,
    homeDir: opts.homeDir,
    logger: opts.logger,
  })

  for (const { plugin, state } of catalog.enabled) {
    const summary = {
      name: plugin.manifest.name,
      scope: plugin.scope,
      description: plugin.manifest.description ?? '',
      skills: plugin.provides.skills,
      mcpServers: plugin.provides.mcpServers,
      binDir: undefined as string | undefined,
      error: plugin.error,
    }
    // Every load answers for each plugin in the Event Center too: an error opens (or keeps) a
    // standing condition for this plugin in this scope, a clean load settles it.
    const finish = () => {
      result.loaded.push(summary)
      const error = summary.error
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
    // Per-plugin text substituter — created once, reused for agents/skills/promptSections.
    const subst = makePluginSubstituter(
      plugin.dir,
      pluginIdOf(plugin),
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

    // ---- MCP servers ------------------------------------------------------
    result.mcpServers.push(...buildMcpRecords(plugin, mcp, opts.userId, now(), opts.logger))

    appendPluginRuntimeDeclarations({ plugin, subst, result })

    finish()
  }

  return result
}
