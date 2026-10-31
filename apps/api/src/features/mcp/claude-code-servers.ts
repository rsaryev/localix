import { join, resolve } from 'node:path'

import { readJsonRecordSync } from '../../lib/json'
import { isRecord } from '../../lib/record'
import { claudeStateFile } from '../cc-settings/config-dir'
import { managedSettingsDir } from '../cc-settings/managed-settings'
import {
  localSettingsRoot,
  readSettingsFileLayers,
  type SettingsFilesInput,
  type SettingsLayer,
} from '../cc-settings/settings-files'
import { claudeCodeSettingsEnv } from '../cc-settings/settings-env'
import { pluginOnlyLocks } from '../cc-settings/settings-policy'
import { claudeCodeTrusts } from '../cc-settings/settings-trust'
import { mcpServerPolicy } from './claude-code-mcp-policy'
import { normalizeMcpServerEntry } from './normalize'
import type { McpServerRecord } from './repository'

/**
 * THE MCP SERVERS A PERSON CONFIGURED FOR CLAUDE CODE, joined to a Localix run in that folder as
 * Claude Code loads them (mcp.md, "MCP installation scopes", "Scope hierarchy and precedence",
 * "Project server approvals and workspace trust"; managed-mcp.md):
 *
 *   user     `mcpServers` of Claude Code's state file (`~/.claude.json`)
 *   local    `projects["<folder>"].mcpServers` of that file, for the folder or its repository root
 *   project  `.mcp.json` of the folder (else the repository root), once approved: by
 *            `enableAllProjectMcpServers` or `enabledMcpjsonServers` in the person's or the
 *            organization's settings, or in the project's own once the folder is trusted;
 *            `disabledMcpjsonServers` in any file rejects one
 *   managed  `managed-mcp.json` takes exclusive control — only its servers and `managedMcpServers`
 *            load; `managedMcpServers` alone adds the organization's servers to the rest
 *
 * A name defined at several scopes loads once, from the highest: managed, local, project, user.
 * A server of Localix's own registry with that name wins over Claude Code's files, as it is the
 * one the person added here. The allow and deny lists apply to every server
 * (`claude-code-mcp-policy.ts`). Read on every run; nothing here writes.
 */

export interface ClaudeCodeMcpInput extends SettingsFilesInput {
  cwd: string
  /** The person's servers in Localix's registry, and the run's plugin servers. */
  own: readonly McpServerRecord[]
  plugins: readonly McpServerRecord[]
  /**
   * Servers a subagent's own file defines (`agent-servers.ts`). They load after every configured
   * one, so a name already taken keeps its configured server, and the allow and deny lists judge
   * them like the rest.
   */
  extra?: readonly McpServerRecord[]
  userId: string
  projectId: string
}

type Scope = 'managed' | 'local' | 'project' | 'user'

const serversOf = (doc: Record<string, unknown> | undefined) =>
  doc && isRecord(doc.mcpServers) ? doc.mcpServers : {}

/** Approved by the honoured files, rejected by none (see the header). */
function approval(layers: readonly SettingsLayer[], trusted: boolean) {
  const honoured = layers.filter(
    (l) => trusted || l.source === 'user' || l.source === 'policy' || l.source === 'flag',
  )
  const all = honoured.some((l) => l.settings.enableAllProjectMcpServers === true)
  const named = new Set(
    honoured.flatMap((l) =>
      Array.isArray(l.settings.enabledMcpjsonServers) ? l.settings.enabledMcpjsonServers : [],
    ),
  )
  const rejected = new Set(
    layers.flatMap((l) =>
      Array.isArray(l.settings.disabledMcpjsonServers) ? l.settings.disabledMcpjsonServers : [],
    ),
  )
  return (name: string) => !rejected.has(name) && (all || named.has(name))
}

export function claudeCodeMcpServers(input: ClaudeCodeMcpInput): McpServerRecord[] {
  const env = input.env ?? process.env
  const layers = readSettingsFileLayers(input)
  const cwd = resolve(input.cwd)
  const root = localSettingsRoot(cwd, input.homeDir, input.platform)
  const state = readJsonRecordSync(claudeStateFile(input.homeDir, env))
  const projects = state && isRecord(state.projects) ? state.projects : {}
  const local = [cwd, root].flatMap((dir) => {
    const entry = dir ? projects[dir] : undefined
    return isRecord(entry) ? [serversOf(entry)] : []
  })
  const managedDir =
    input.managed === null ? null : (input.managed?.dir ?? managedSettingsDir(input.platform))
  const exclusive = managedDir
    ? readJsonRecordSync(join(managedDir, 'managed-mcp.json'))
    : undefined
  const provided = layers
    .filter((l) => l.source === 'policy')
    .map((l) => (isRecord(l.settings.managedMcpServers) ? l.settings.managedMcpServers : {}))
  const trusted = claudeCodeTrusts(input)
  const approved = approval(layers, trusted)
  const mcpJson =
    readJsonRecordSync(join(cwd, '.mcp.json')) ??
    (root ? readJsonRecordSync(join(root, '.mcp.json')) : undefined)

  // Highest scope first; the first definition of a name is the one that loads.
  const ranked: Array<[Scope, Record<string, unknown>]> = [
    ...(exclusive ? [['managed', serversOf(exclusive)] as [Scope, Record<string, unknown>]] : []),
    ...provided.map((servers): [Scope, Record<string, unknown>] => ['managed', servers]),
  ]
  // `strictPluginOnlyCustomization` with `mcp`: `~/.claude.json` and `.mcp.json` are closed.
  if (!exclusive && !pluginOnlyLocks(layers).has('mcp')) {
    for (const servers of local) ranked.push(['local', servers])
    const project = Object.fromEntries(
      Object.entries(serversOf(mcpJson)).filter(([name]) => approved(name)),
    )
    ranked.push(['project', project], ['user', serversOf(state)])
  }

  const policy = mcpServerPolicy(layers, env)
  const taken = new Set<string>()
  const out: McpServerRecord[] = []
  const add = (server: McpServerRecord, organization: boolean) => {
    if (taken.has(server.name)) return
    taken.add(server.name)
    if (policy.admits(server, organization)) out.push(server)
  }
  for (const server of exclusive ? [] : input.own) add(server, false)
  for (const [scope, servers] of ranked)
    for (const [name, raw] of Object.entries(servers)) {
      if (!isRecord(raw) || taken.has(name)) continue
      const record = recordOf(scope, name, raw, input, trusted)
      if (record) add(record, scope === 'managed')
    }
  for (const server of exclusive ? [] : input.plugins) add(server, false)
  for (const server of exclusive ? [] : (input.extra ?? [])) add(server, false)
  // The folder's settings `env` sets the limits Claude Code reads from its environment.
  const settingsEnv = claudeCodeSettingsEnv(input)
  return Object.keys(settingsEnv).length > 0 ? out.map((s) => ({ ...s, settingsEnv })) : out
}

function recordOf(
  scope: Scope,
  name: string,
  raw: Record<string, unknown>,
  input: ClaudeCodeMcpInput,
  trusted: boolean,
): McpServerRecord | undefined {
  try {
    const parsed = normalizeMcpServerEntry(name, raw, input.projectId)
    if (parsed.enabled === false) return undefined
    // A `headersHelper` is a shell command: a project or local server's runs only in a trusted
    // folder, and until then the server connects with its static headers alone (mcp.md, "Trust a
    // folder before its headersHelper runs"). Project servers are also approved above to load at all.
    if ((scope === 'project' || scope === 'local') && !trusted && 'headersHelper' in parsed.config)
      delete (parsed.config as { headersHelper?: string }).headersHelper
    return {
      id: `claude-code:${scope}:${name}`,
      userId: input.userId,
      projectId: input.projectId,
      name: parsed.name,
      description: parsed.description ?? '',
      transport: parsed.transport,
      config: parsed.config as Record<string, unknown>,
      createdAt: '',
      updatedAt: '',
    }
  } catch {
    // An entry Claude Code could not load either; the others still load.
    return undefined
  }
}
