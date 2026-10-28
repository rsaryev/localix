import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { readAvailability } from '../../capabilities/availability'
import { mcpClientManager } from '../../mcp/client-manager'
import type { McpServerOutcome } from '../../mcp/mcp-gather'
import type { McpServerRecord } from '../../mcp/repository'
import type { SessionRecord } from '../repository'
import type { MessageMutationResponse } from '../contracts'
import type { CommandHandlerContext, DirectReply } from './command-handlers'
import { sessionMcpServers } from './mcp-session-servers'

/** Where a server comes from, as `/mcp` groups it (Claude Code's scopes, plus Localix's own). */
export type McpSource =
  | 'localix'
  | 'localix-project'
  | 'user'
  | 'project'
  | 'local'
  | 'managed'
  | 'plugin'

/** The groups of the listing, in the order they are shown. */
const GROUPS: ReadonlyArray<{ source: McpSource; heading: string }> = [
  { source: 'localix', heading: 'Localix' },
  { source: 'localix-project', heading: 'Localix (this project)' },
  { source: 'user', heading: 'User' },
  { source: 'project', heading: 'Project (.mcp.json)' },
  { source: 'local', heading: 'Local' },
  { source: 'managed', heading: 'Managed' },
  { source: 'plugin', heading: 'Plugin' },
]

/** The source of a server record, read from its id (`claude-code:<scope>:…`, `plugin:…`). */
export function mcpSourceOf(server: Pick<McpServerRecord, 'id' | 'projectId'>): McpSource {
  if (server.id.startsWith('plugin:')) return 'plugin'
  const scope = /^claude-code:([a-z]+):/.exec(server.id)?.[1]
  if (scope === 'user' || scope === 'project' || scope === 'local' || scope === 'managed')
    return scope
  return server.projectId ? 'localix-project' : 'localix'
}

/** The name `/mcp` shows: the server's own, or a plugin's `plugin:<plugin>:<server>`. */
const labelOf = (server: Pick<McpServerRecord, 'id' | 'name'>) =>
  server.id.startsWith('plugin:') ? server.id : server.name

/** One row of `/mcp`: a server the session can reach, as the listing shows it. */
export interface McpListingRow {
  label: string
  /** `stdio`, `http` … */
  transport?: string
  source: McpSource
  detail?: string
  enabled: boolean
  status: McpServerOutcome | undefined
}

/** Longest connection error a row carries; the rest is in the server log. */
const ERROR_MAX_CHARS = 200

/** A server's latest connection outcome in Claude Code's words (`✘ Failed to connect`). */
export function statusText(status: McpServerOutcome | undefined): string {
  if (!status) return 'not connected yet'
  if (status.error) {
    const error = status.error.replace(/\s+/g, ' ').trim().slice(0, ERROR_MAX_CHARS)
    return `failed to connect: ${error}`
  }
  if (status.pending) return 'connecting'
  if (status.cached) return `cached · connects on first use · ${status.toolCount} tools`
  return `connected · ${status.toolCount} tools`
}

/** The `/mcp` reply for these rows; pure, so the wording is testable without a session. */
export function renderMcpListing(rows: readonly McpListingRow[]): string {
  if (rows.length === 0)
    return 'No MCP servers configured. Add one in the Store (manual form, paste a `mcpServers` JSON blob, or a one-line `npx …` command).'
  const sections = GROUPS.flatMap(({ source, heading }) => {
    const group = rows.filter((row) => row.source === source)
    if (group.length === 0) return []
    return [
      `### ${heading}`,
      ...group.map((row) => {
        const state = row.enabled ? statusText(row.status) : 'disabled'
        const detail = row.detail ? ` — ${row.detail}` : ''
        const kind = row.transport ? ` _(${row.transport})_` : ''
        return `- \`${row.label}\`${kind} · ${state}${detail}`
      }),
      '',
    ]
  })
  return [
    '**MCP servers** — tools appear in chat as `mcp_<server>_<tool>`. Manage them with `/mcp reconnect <server>`, `/mcp enable <server|all>` and `/mcp disable <server|all>`.',
    '',
    ...sections,
  ]
    .join('\n')
    .trimEnd()
}

export type McpCommand =
  | { action: 'list' }
  | { action: 'reconnect' | 'enable' | 'disable'; target?: string }
  | { action: 'unknown'; target: string }

/** `/mcp [list | reconnect <server> | enable <server|all> | disable <server|all>]`. */
export function parseMcpCommand(prompt: string): McpCommand {
  const [, sub = 'list', ...rest] = prompt.trim().split(/\s+/)
  const action = sub.toLowerCase()
  const target = rest.join(' ').trim() || undefined
  if (action === 'list') return { action: 'list' }
  if (action === 'reconnect' || action === 'enable' || action === 'disable')
    return { action, ...(target ? { target } : {}) }
  return { action: 'unknown', target: sub }
}

/** What `/mcp` needs from the session: its servers, their switches and their connections. */
export interface McpCommandPorts {
  /** The servers a run of this session would connect, as a run builds them. */
  servers(): Promise<McpServerRecord[]>
  cwd: string
  enabled(name: string): boolean
  setEnabled(names: string[], enabled: boolean): Promise<void>
  status(server: McpServerRecord): McpServerOutcome | undefined
  reconnect(server: McpServerRecord, cwd: string): Promise<McpServerOutcome>
}

const USAGE = [
  '/mcp',
  '/mcp reconnect <server>',
  '/mcp enable <server|all>',
  '/mcp disable <server|all>',
]

const detailOf = (server: McpServerRecord) =>
  server.transport === 'stdio'
    ? ((server.config.command as string[] | undefined) ?? []).join(' ')
    : ((server.config.url as string | undefined) ?? '')

/** Runs a parsed `/mcp` command and returns its reply; the only effects go through `ports`. */
export async function runMcpCommand(ports: McpCommandPorts, command: McpCommand): Promise<string> {
  if (command.action === 'unknown')
    return `Unknown /mcp command \`${command.target}\`. Usage:\n${USAGE.map((u) => `- \`${u}\``).join('\n')}`
  const servers = await ports.servers()
  if (command.action === 'list')
    return renderMcpListing(
      servers.map((server) => ({
        label: labelOf(server),
        transport: server.transport,
        source: mcpSourceOf(server),
        detail: detailOf(server) || undefined,
        enabled: ports.enabled(server.name),
        status: ports.status(server),
      })),
    )

  if (!command.target)
    return `Usage: \`/mcp ${command.action} <server${command.action === 'reconnect' ? '' : '|all'}>\``
  const everyone = command.action !== 'reconnect' && command.target.toLowerCase() === 'all'
  const named = servers.filter(
    (server) => everyone || labelOf(server) === command.target || server.name === command.target,
  )
  if (named.length === 0)
    return `No MCP server named \`${command.target}\`. Servers: ${
      servers.map((server) => `\`${labelOf(server)}\``).join(', ') || 'none'
    }.`

  if (command.action === 'reconnect') {
    const server = named[0]!
    if (!ports.enabled(server.name))
      return `\`${labelOf(server)}\` is disabled. Enable it first with \`/mcp enable ${labelOf(server)}\`.`
    const outcome = await ports.reconnect(server, ports.cwd)
    return outcome.ok
      ? `Reconnected \`${labelOf(server)}\`: ${statusText(outcome)}.`
      : `Could not reconnect \`${labelOf(server)}\`: ${statusText(outcome)}`
  }

  const enable = command.action === 'enable'
  const changing = named.filter((server) => ports.enabled(server.name) !== enable)
  if (changing.length === 0)
    return `Nothing to do: ${everyone ? 'every server' : `\`${labelOf(named[0]!)}\``} is already ${
      enable ? 'enabled' : 'disabled'
    }.`
  await ports.setEnabled(
    changing.map((server) => server.name),
    enable,
  )
  return `${enable ? 'Enabled' : 'Disabled'} ${changing
    .map((server) => `\`${labelOf(server)}\``)
    .join(', ')}. It takes effect on the next turn.`
}

/**
 * Handles `/mcp`: the MCP servers the session can reach, grouped by source, each with its latest
 * connection outcome, plus reconnect, enable and disable. The servers are the ones a run would
 * connect (the person's own, Claude Code's files, the organization's, the enabled plugins').
 * Listing never connects; `reconnect` does, for the one server it names.
 */
export async function handleMcpControlCommand(
  ctx: Pick<
    CommandHandlerContext,
    | 'mcpRepo'
    | 'deps'
    | 'availabilityWriter'
    | 'loadSessionPluginMcpServers'
    | 'resolveSessionWorkingDir'
  >,
  userId: string,
  session: SessionRecord,
  prompt: string,
  directReply: DirectReply,
): Promise<MessageMutationResponse> {
  const cwd = await ctx.resolveSessionWorkingDir(userId, session)
  const agentId = session.agent?.agentId || DEFAULT_AGENT_ID
  const availability = await readAvailability(ctx.deps.db, { userId, agentId })
  // Read and written for the agent the session's runs read it from, so a reply is what runs see.
  const ports: McpCommandPorts = {
    cwd,
    servers: () => sessionMcpServers(ctx, userId, session, cwd),
    enabled: (name) => availability.effectFor('mcp', name) !== 'deny',
    setEnabled: (names, enabled) =>
      ctx.availabilityWriter.set(
        userId,
        agentId,
        'mcp',
        names.map((name) => ({ name, enabled })),
      ),
    status: (server) => mcpClientManager.serverStatus(server),
    reconnect: (server, at) => mcpClientManager.reconnect(server, at),
  }
  return directReply(await runMcpCommand(ports, parseMcpCommand(prompt)))
}
