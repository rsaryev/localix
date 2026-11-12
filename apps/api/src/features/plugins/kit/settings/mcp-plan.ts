import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expandMcpServer, type PluginMcpServer } from '@rsaryev/llx-plugin/format'
import {
  claudeJsonProject,
  claudeJsonServers,
  projectFileServers,
  readManagedMcpFile,
  readProjectToggles,
  type ConfiguredCandidate,
  type McpCandidate,
  type PlanSource,
  type PlannedServer,
  type FileScope,
} from '@rsaryev/llx-plugin/settings'
import { readJsonRecordSync } from '../../../../lib/json'
import { isRecord } from '../../../../lib/record'
import { claudeStateFile } from '../../../cc-settings/config-dir'
import type { ClaudeCodeMcpInput } from '../../../mcp/claude-code-servers'
import type { McpServerRecord } from '../../../mcp/repository'
import { settingsEnvOf } from './env'
import { managedSettingsDir } from './managed'
import { mcpServerShape } from './mcp-record'
import { readClaudeSettingsSync, type ClaudeSettings } from './read'
import { repositoryApprovalsCount, trustSourceOf } from './trust'
import type { TrustSource } from '@rsaryev/llx-plugin/loading'

/**
 * THE MCP SERVERS CLAUDE CODE WOULD LOAD IN A FOLDER, decided by the kit (`mcpLoadPlan` through the
 * folder's `resolvePolicy(...).mcp`): the scopes of `~/.claude.json` and `.mcp.json`, the project
 * servers' approval, `managed-mcp.json`'s exclusive control and `managedMcpServers`, the precedence of
 * one name over the scopes, the `/mcp` toggles, `strictPluginOnlyCustomization` with `mcp`, and
 * `allowedMcpServers` / `deniedMcpServers` / `allowManagedMcpServersOnly` over each server. Localix
 * reads the files (host I/O) and turns what loads into its records (`mcp/claude-code-servers.ts`).
 *
 * Localix's own registry is not a Claude Code scope: its servers take their names first (the one the
 * person added here), the lists judge them like the rest, and exclusive control leaves them out, as
 * it leaves out a subagent's inline servers, which load last.
 */

function textOf(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

/** A Localix record as the kit reads a server entry: `command` + `args`, or a remote `url`. */
export function kitServerOf(
  record: Pick<McpServerRecord, 'transport' | 'config'>,
): PluginMcpServer {
  const config = record.config
  const headers = isRecord(config.headers) ? (config.headers as Record<string, string>) : undefined
  if (typeof config.url === 'string')
    return {
      type: record.transport === 'ws' ? 'ws' : 'http',
      url: config.url,
      ...(headers ? { headers } : {}),
    } as PluginMcpServer
  const command = Array.isArray(config.command) ? config.command.map(String) : []
  const env = isRecord(config.env) ? (config.env as Record<string, string>) : undefined
  return {
    command: command[0] ?? '',
    args: command.slice(1),
    ...(env ? { env } : {}),
  }
}

/**
 * A Claude Code file's server with the trust of the folder it was read in, for its `headersHelper`'s
 * gate (`mcp-remote.ts`, `planHeadersHelper`): stamped over whatever the entry wrote under that key,
 * so a repository cannot claim a trust of its own.
 */
function withHelperTrust(
  record: McpServerRecord | undefined,
  trust: { source: TrustSource; key: string },
): McpServerRecord | undefined {
  return record && { ...record, config: { ...record.config, headersHelperTrust: trust } }
}

/** A server of a Claude Code file as a Localix record; undefined when the record refuses it. */
function claudeCodeServerRecord(
  scope: FileScope,
  server: PluginMcpServer,
  name: string,
  input: ClaudeCodeMcpInput,
): McpServerRecord | undefined {
  const shape = mcpServerShape(name, server)
  return (
    shape && {
      ...shape,
      id: `claude-code:${scope}:${name}`,
      userId: input.userId,
      projectId: input.projectId,
      description: '',
      createdAt: '',
      updatedAt: '',
    }
  )
}

/** The project path `~/.claude.json` keys the folder by: the folder, else its repository root. */
function projectKey(state: unknown, cwd: string, root: string | undefined): string {
  return claudeJsonProject(state, cwd) === undefined && root ? root : cwd
}

const SCOPE_OF: { readonly [S in PlanSource]?: FileScope } = {
  managedFile: 'managed',
  managedSettings: 'managed',
  local: 'local',
  project: 'project',
  user: 'user',
}

export function claudeCodeMcpPlan(
  input: ClaudeCodeMcpInput,
  settings: ClaudeSettings = readClaudeSettingsSync(input),
): McpServerRecord[] {
  const env = input.env ?? process.env
  const cwd = resolve(input.cwd)
  const root = settings.localRoot
  const state = readJsonRecordSync(claudeStateFile(input.homeDir, env))
  const key = projectKey(state, cwd, root)
  const mcpJson =
    readJsonRecordSync(join(cwd, '.mcp.json')) ??
    (root ? readJsonRecordSync(join(root, '.mcp.json')) : undefined)
  const managedDir =
    input.managed === null ? null : (input.managed?.dir ?? managedSettingsDir(input.platform))
  const managedText = managedDir ? textOf(join(managedDir, 'managed-mcp.json')) : undefined
  const managedFile = readManagedMcpFile(managedText).file
  const mcp = settings.policy().mcp
  const trust = { source: trustSourceOf(settings.trust.situation), key: settings.trust.key }

  const user = claudeJsonServers(state, key).candidates
  const file = projectFileServers(mcpJson).candidates
  const approved = new Set(
    mcp
      .projectServerApproval(
        file.map((one) => one.name),
        {
          // Approvals stored for the folder count only once the folder itself is trusted.
          folderTrusted: repositoryApprovalsCount(settings.trust.situation),
        },
      )
      .filter((one) => one.status === 'approved')
      .map((one) => one.name),
  )
  const plugins = new Map(input.plugins.map((record) => [record.name, record]))
  const lookup = (name: string) => env[name]
  // Expanded, so a plugin server meets a configured one at the endpoint it will connect to.
  const expanded = (candidate: McpCandidate): ConfiguredCandidate[] => {
    const server = expandMcpServer(candidate.name, candidate.server, lookup).server
    return server ? [{ ...candidate, server } as ConfiguredCandidate] : []
  }
  const plan = mcp.loadPlan({
    ...(managedFile ? { managedFile } : {}),
    candidates: [
      ...user,
      ...file.filter((one) => approved.has(one.name)),
      ...input.plugins.map((record) => ({
        scope: 'plugin' as const,
        name: record.name,
        server: kitServerOf(record),
      })),
    ].flatMap(expanded),
    session: { cloud: false },
    toggles: readProjectToggles(state, key),
  })

  // The record keeps a configured server as the kit read it: its references expand when it connects.
  const asRead = new Map([...user, ...file].map((one) => [`${one.scope}:${one.name}`, one.server]))
  const serverOf = (planned: PlannedServer, scope: FileScope) =>
    scope === 'managed' ? planned.server : asRead.get(`${scope}:${planned.name}`)
  const policy = mcp.serverPolicy()
  const admitted = (record: McpServerRecord) =>
    policy.check({ name: record.name, server: kitServerOf(record) }).allowed

  const taken = new Set<string>()
  const out: McpServerRecord[] = []
  const add = (record: McpServerRecord | undefined, check: boolean) => {
    if (!record || taken.has(record.name)) return
    taken.add(record.name)
    if (!check || admitted(record)) out.push(record)
  }
  for (const record of plan.exclusive ? [] : input.own) add(record, true)
  for (const planned of plan.servers) {
    if (!planned.enabled) continue
    const scope = SCOPE_OF[planned.source]
    if (planned.source === 'plugin') add(plugins.get(planned.name), false)
    else if (scope) {
      const server = serverOf(planned, scope)
      if (server)
        add(
          withHelperTrust(claudeCodeServerRecord(scope, server, planned.name, input), trust),
          false,
        )
    }
  }
  for (const record of plan.exclusive ? [] : (input.extra ?? [])) add(record, true)
  // The folder's settings `env` sets the limits Claude Code reads from its environment.
  const settingsEnv = settingsEnvOf(settings)
  return Object.keys(settingsEnv).length > 0 ? out.map((s) => ({ ...s, settingsEnv })) : out
}
