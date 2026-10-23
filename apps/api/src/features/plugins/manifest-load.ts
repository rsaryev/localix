import { basename, join } from 'node:path'

import type { PluginIssue } from '@localixai/claude-plugin'

import { listSubdirs, pathExists } from '../ext/fs-discovery'

import {
  pluginCommandSchema,
  type PluginAgent,
  type PluginCommand,
  type PluginManifest,
  type PluginProvides,
} from './contracts'
import { mapCcTools, parseAgentFile, parseCommandFile } from './discovery-cc-files'
import type { DiscoveredPlugin } from './discovery-types'
import { resolveEntrypoints } from './discovery-entrypoints'
import { parseComposedManifest } from './manifest-parse'
import { composeManifest, type ManifestFiles } from './layout/compose'
import { readManifestFiles } from './layout/read'
import { CC_INERT_HOOK_EVENTS, isCcHookEvent, isInertCcHookEvent } from '../cc-hooks/contracts'
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
 * Hook events the plugin's hooks files name that never fire here: a Claude Code event with no
 * Localix lifecycle point (said with the reason), or a name that is no Claude Code event at all.
 */
function hookIssues(configs: readonly unknown[]): PluginIssue[] {
  const events = new Set<string>()
  for (const config of configs) {
    if (!isRecord(config)) continue
    const map = isRecord(config.hooks) ? config.hooks : config.modules ? {} : config
    // An event names an array of matcher groups; `description` and the like are not events.
    for (const [event, groups] of Object.entries(map))
      if (Array.isArray(groups) && !isCcHookEvent(event)) events.add(event)
  }
  const sorted = [...events].sort()
  const unknown = sorted.filter((event) => !isInertCcHookEvent(event))
  return [
    ...sorted.filter(isInertCcHookEvent).map((event): PluginIssue => ({
      severity: 'warning',
      path: 'hooks',
      message: `Hook event ${event} never fires in Localix: ${CC_INERT_HOOK_EVENTS[event]}`,
    })),
    ...(unknown.length
      ? [
          {
            severity: 'warning' as const,
            path: 'hooks',
            message: `Not Claude Code hook events, never fired: ${unknown.join(', ')}`,
          },
        ]
      : []),
  ]
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
 * Parse one plugin directory into a DiscoveredPlugin (never throws). Its
 * `.claude-plugin/plugin.json` is read as Claude Code reads it (`layout/compose.ts`); a folder with
 * none is a plugin named after itself (Claude Code parity), as long as it holds a recognized
 * component.
 *
 * `withManifests` lets a caller that reads a folder in place combine what it holds with what
 * Claude Code would combine it with — its marketplace entry (`claude-code-installs.ts`).
 */
export async function loadManifest(
  dir: string,
  scope: 'global' | 'project',
  projectId: string,
  withManifests?: (files: ManifestFiles) => ManifestFiles,
): Promise<DiscoveredPlugin> {
  const files = await readManifestFiles(dir)
  const composed = composeManifest(withManifests ? withManifests(files) : files, basename(dir))
  // A malformed manifest errors, a missing one does not (`manifest-parse.ts`).
  const parsed = parseComposedManifest(composed, basename(dir))
  const { manifest, rawManifest } = parsed
  // "`userConfig` options … are strict. An unknown key inside one is an error, and the plugin
  // doesn't load." The option used to be dropped with an issue and the plugin loaded anyway.
  const strictIssue = composed.issues.find(
    (found) => found.severity === 'error' && /(^|#)userConfig\./.test(found.path),
  )
  const promoted = parsed.error ? undefined : strictIssue
  const error = parsed.error ?? (promoted ? `${promoted.message} (${promoted.path})` : undefined)

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
    if (agent && !seenAgentNames.has(agent.name)) {
      agents.push(agent)
      seenAgentNames.add(agent.name)
    }
  }
  const agentNames = [...new Set(agents.map((agent) => `${manifest.name}:${agent.name}`))]
  const provides: PluginProvides = {
    skills: skillNames,
    mcpServers: Object.keys(entrypoints.mcpServers),
    commands: commands.map((c) => c.name),
    ...(agentNames.length ? { agents: agentNames } : {}),
    ...(Object.keys(entrypoints.lspServers).length
      ? { lspServers: Object.keys(entrypoints.lspServers) }
      : {}),
  }
  const manifestIssues = [
    // A promoted issue is the plugin's error now; listing it twice would count it twice.
    ...composed.issues.filter((found) => found !== promoted),
    // A hooks file that failed to load: the plugin runs without the hooks in it.
    ...(entrypoints.hookErrors ?? []).map((message): PluginIssue => ({
      severity: 'error',
      path: 'hooks',
      message,
    })),
    ...hookIssues(entrypoints.hookConfigs),
  ]
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
    error,
    ...(manifestIssues.length ? { manifestIssues } : {}),
  }
}
