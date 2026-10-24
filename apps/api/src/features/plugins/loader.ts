import { existsSync } from 'node:fs'
import { dataDirOfPlugin, pluginIdOf } from './plugin-data-id'
import { join } from 'node:path'

import { type CapabilitySourceRepository, scalarConfig } from '../capabilities/source-repository'
import type { AvailabilityReader } from '../capabilities/availability'
import { errorMessage } from '../../lib/errors'
import { readSkillsFromRoot } from '../agent-core/skill-discovery'
import { pluginLoadBlockReason } from './load-block'
import { buildPluginCatalog } from './catalog'
import { buildLoadedAgent, emptyLoadedPlugins, type LoadedPlugins } from './loader-contract'
import { resolvePluginConfig } from './config'
import { recordPluginLoad } from '../notifications/conditions/plugins'
import { buildMcpRecords } from './mcp'
import {
  makePluginSubstituter,
  appendPluginRuntimeDeclarations,
} from './loader-runtime-declarations'

export type { LoadedPluginMonitor, LoadedPlugins } from './loader-contract'

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

  for (const { plugin, state } of catalog.enabled) {
    const summary = {
      name: plugin.manifest.name,
      scope: plugin.scope,
      description: plugin.manifest.description,
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
    result.mcpServers.push(
      ...buildMcpRecords(plugin, config, opts.userId, now(), opts.homeDir, opts.logger, {
        projectDir: opts.cwd || undefined,
      }),
    )

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
          skill.pluginDataDir = dataDirOfPlugin(plugin, opts.homeDir)
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

  return result
}
