import { basename, join } from 'node:path'

import type { PluginIssue } from '@localixai/claude-plugin'

import { listSubdirs, pathExists } from '../ext/fs-discovery'

import {
  AGENTS_MAX_PER_PLUGIN,
  pluginCommandSchema,
  type PluginAgent,
  type PluginCommand,
  type PluginManifest,
  type PluginProvides,
} from './contracts'
import { mapCcTools, parseAgentFile, parseCommandFile } from './discovery-cc-files'
import type { DiscoveredPlugin } from './discovery-types'
import { resolveEntrypoints } from './discovery-entrypoints'
import { parseComposedManifest } from './discovery-manifest-recovery'
import { composeManifest } from './layout/compose'
import { readManifestFiles } from './layout/read'
import { agentContributionSchema } from '../agents/contribution'
import { isCcHookEvent } from '../cc-hooks/contracts'
import { isRecord } from '../../lib/record'

/** Parse the inline command objects from a manifest `commands` field. */
function parseInlineCommands(field: PluginManifest['commands']): PluginCommand[] {
  if (!Array.isArray(field)) return []
  const out: PluginCommand[] = []
  for (const entry of field) {
    const parsed = pluginCommandSchema.safeParse(entry)
    if (!parsed.success) continue
    const cmd = parsed.data
    // Map CC tool names to engine names (Bash→bash, Grep→search) via CC_TOOL_NAME_MAP.
    if (cmd.allowedTools?.length) {
      cmd.allowedTools = [...new Set(cmd.allowedTools.flatMap((t) => mapCcTools(t)))] // dedup
    }
    if (cmd.disallowedTools?.length) {
      cmd.disallowedTools = [...new Set(cmd.disallowedTools.flatMap((t) => mapCcTools(t)))]
    }
    out.push(cmd)
  }
  return out
}

/**
 * What the plugin's hooks ask for that Localix does not run: events it does not dispatch, and a
 * hooks module (a mod), whose runtime is not here yet.
 */
function hookIssues(configs: readonly unknown[]): PluginIssue[] {
  const events = new Set<string>()
  let modules = false
  for (const config of configs) {
    if (!isRecord(config)) continue
    if (Array.isArray(config.modules) && config.modules.length) modules = true
    const map = isRecord(config.hooks) ? config.hooks : config.modules ? {} : config
    for (const event of Object.keys(map)) if (!isCcHookEvent(event)) events.add(event)
  }
  return [
    ...(events.size
      ? [
          {
            severity: 'warning' as const,
            path: 'hooks',
            message: `Hook events not dispatched by Localix: ${[...events].sort().join(', ')}`,
          },
        ]
      : []),
    ...(modules
      ? [
          {
            severity: 'warning' as const,
            path: 'hooks#modules',
            message: 'The hooks module (mod) does not run in Localix yet; its hooks.json hooks do',
          },
        ]
      : []),
  ]
}

/**
 * A mini app's presentation of its plugin's commands (`commandOptions`): pickers, `featured`,
 * `activateTools`. The plugin's prompt is kept; a name the plugin does not declare is ignored.
 */
function applyCommandOptions(
  commands: PluginCommand[],
  options: PluginManifest['commandOptions'],
): void {
  if (!options) return
  for (const command of commands) {
    const extra = options[command.name]
    if (extra) Object.assign(command, extra)
  }
}

/** Read the skill names inside resolved skill dirs (a subdir is a skill iff it has SKILL.md). */
async function readSkillNames(skillDirs: string[]): Promise<string[]> {
  const allNames = await Promise.all(
    skillDirs.map(async (root) => {
      const subs = await listSubdirs(root)
      const [rootIsSkill, ...subChecks] = await Promise.all([
        pathExists(join(root, 'SKILL.md')),
        ...subs.map((sub) => pathExists(join(root, sub, 'SKILL.md'))),
      ])
      const names: string[] = []
      if (rootIsSkill) names.push(basename(root))
      for (let i = 0; i < subs.length; i++) if (subChecks[i]) names.push(subs[i])
      return names
    }),
  )
  return allNames.flat()
}

/**
 * Parse one extension directory into a DiscoveredPlugin (never throws). The folder's plugin
 * (`.claude-plugin/plugin.json`), mini app (`.localix-app/app.json`) or legacy root `plugin.json`
 * is composed into one runtime manifest (`layout/compose.ts`); a folder with none is a plugin named
 * after itself (Claude Code parity), as long as it holds a recognized component.
 */
export async function loadManifest(
  dir: string,
  scope: 'global' | 'project',
  projectId: string,
  bundled = false,
): Promise<DiscoveredPlugin> {
  const composed = composeManifest(await readManifestFiles(dir), basename(dir))
  // Promote, validate and recover live in parseComposedManifest: a malformed manifest errors, a
  // missing one does not.
  const { manifest, rawManifest, error, manifestRecovered } = parseComposedManifest(
    composed,
    basename(dir),
  )

  const entrypoints = await resolveEntrypoints(dir, manifest)
  // Parse command and agent files in parallel (independent reads).
  const [parsedCmdFiles, parsedAgentFiles, skillNames] = await Promise.all([
    Promise.all(
      entrypoints.commandFiles.map((c) =>
        parseCommandFile(c.file, c.name, entrypoints.diagnostics),
      ),
    ),
    Promise.all(
      entrypoints.agentFiles.map((a) => parseAgentFile(a.file, a.name, entrypoints.diagnostics)),
    ),
    readSkillNames(entrypoints.skillDirs),
  ])
  // Inline objects first (win on clash), then file-based (parsed above).
  const commands = parseInlineCommands(manifest.commands)
  const seenCommandNames = new Set(commands.map((c) => c.name))
  for (const cmd of parsedCmdFiles) {
    if (cmd && !seenCommandNames.has(cmd.name)) {
      commands.push(cmd)
      seenCommandNames.add(cmd.name)
    }
  }
  applyCommandOptions(commands, manifest.commandOptions)
  const agents: PluginAgent[] = Array.isArray(manifest.agents)
    ? manifest.agents.filter((a): a is PluginAgent => typeof a === 'object' && a !== null)
    : []
  const seenAgentNames = new Set(agents.map((a) => a.name))
  for (const agent of parsedAgentFiles) {
    if (agents.length >= AGENTS_MAX_PER_PLUGIN) break
    if (agent && !seenAgentNames.has(agent.name)) {
      agents.push(agent)
      seenAgentNames.add(agent.name)
    }
  }
  const agentNames = [
    ...new Set([
      ...agents.map((agent) => `${manifest.name}:${agent.name}`),
      ...(manifest.contributions ?? []).flatMap((entry) => {
        if (entry.kind !== 'agent') return []
        const parsed = agentContributionSchema.safeParse(entry.value)
        return parsed.success ? [`${manifest.name}:${parsed.data.definition.handle}`] : []
      }),
    ]),
  ]
  const provides: PluginProvides = {
    hasNativeTools: entrypoints.toolEntries.length > 0,
    tools: [], // filled by live inspection for enabled plugins
    skills: skillNames,
    mcpServers: Object.keys(entrypoints.mcpServers),
    commands: commands.map((c) => c.name),
    ...(agentNames.length ? { agents: agentNames } : {}),
    ...(Object.keys(entrypoints.lspServers).length
      ? { lspServers: Object.keys(entrypoints.lspServers) }
      : {}),
  }
  const layoutIssues = [...composed.issues, ...hookIssues(entrypoints.hookConfigs)]
  entrypoints.diagnostics?.sort((a, b) =>
    `${a.kind}\0${a.path}\0${a.message}`.localeCompare(`${b.kind}\0${b.path}\0${b.message}`),
  )

  return {
    manifest,
    rawManifest,
    dir,
    scope,
    projectId,
    entrypoints,
    provides,
    commands,
    agents,
    bundled,
    error,
    layout: composed.layout,
    ...(layoutIssues.length ? { layoutIssues } : {}),
    ...(manifestRecovered ? { manifestRecovered: true } : {}),
  }
}
