import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import type { AvailabilityReader } from '../capabilities/availability'
import { buildPluginCatalog } from './catalog'
import { catalogRun, kitPluginsOf } from './catalog-kit'
import { issueLine, type LocalixPluginHost, type ManagedSettingsSource } from './kit'
import { emptyLoadedPlugins, type LoadedPlugins } from './loader-contract'
import { recordPluginLoad } from '../notifications/conditions/plugins'
import { buildMcpRecords } from './mcp'
import { appendPluginRuntimeDeclarations } from './loader-runtime-declarations'

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
  /** The managed settings that may turn a plugin on or off; the machine's own by default. */
  managed?: ManagedSettingsSource | null
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
  // Which plugins run is the kit's verdict in a session of the scope, as a chat's run judges it:
  // the agent's selection, managed settings over it, and the plugins' dependencies.
  const run = await catalogRun(opts.pluginHost, catalog, {
    cwd: opts.cwd || opts.homeDir,
    homeDir: opts.homeDir,
    ...(opts.managed === undefined ? {} : { managed: opts.managed }),
  })
  const mcp = await run.mcpServers()
  for (const issue of mcp.issues) opts.logger?.warn(issueLine(issue))

  for (const { plugin, error } of run.entries) {
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
    // name…), or a dependency that is not installed, disabled or outside its range (the kit's
    // verdict; plugins/troubleshooting.md, "Dependency errors"). `summary.error` carries the
    // reason, which the plugin row already renders — a plugin that contributes nothing must say why.
    if (error) {
      summary.error = error
      finish()
      continue
    }

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

    appendPluginRuntimeDeclarations({ plugin, result })

    finish()
  }

  return result
}
