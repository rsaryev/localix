import { basename, join } from 'node:path'

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
import { findManifestPath } from './discovery'
import type { DiscoveredPlugin } from './discovery-types'
import { resolveEntrypoints } from './discovery-entrypoints'
import { parseManifestFile } from './discovery-manifest-recovery'
import { agentContributionSchema } from '../agents/contribution'

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
 * Parse one plugin directory into a DiscoveredPlugin (never throws). Reads only the
 * native root `plugin.json`; foreign layouts are converted at install time
 * (`import-claude-code.ts`) and never read here.
 */
export async function loadManifest(
  dir: string,
  scope: 'global' | 'project',
  projectId: string,
  bundled = false,
): Promise<DiscoveredPlugin> {
  const manifestPath = await findManifestPath(dir)
  // The manifest is OPTIONAL (Claude Code parity): a directory with only component
  // folders (skills/commands/agents/.mcp.json) is a valid plugin named after its dir.
  // Read+CC-promote+validate+recover lives in parseManifestFile — a malformed
  // manifest errors, a missing one does not.
  const { manifest, rawManifest, error, manifestRecovered } = await parseManifestFile(
    manifestPath,
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
    ...(manifestRecovered ? { manifestRecovered: true } : {}),
  }
}
