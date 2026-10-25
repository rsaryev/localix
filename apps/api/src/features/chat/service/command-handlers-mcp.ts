import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { readAvailability } from '../../capabilities/availability'
import { mcpClientManager } from '../../mcp/client-manager'
import type { McpServerOutcome } from '../../mcp/mcp-gather'
import type { SessionRecord } from '../repository'
import type { MessageMutationResponse } from '../contracts'
import type { CommandHandlerContext, DirectReply } from './command-handlers'

/** One row of `/mcp`: a server the session can reach, as the listing shows it. */
export interface McpListingRow {
  /** The name `/mcp` shows: the person's own name, or a plugin's `plugin:<plugin>:<server>`. */
  label: string
  /** `stdio`, `http` … — unknown for a plugin's server until it is loaded. */
  transport?: string
  scope: 'project' | 'global' | 'plugin'
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
    return `✘ failed to connect: ${error}`
  }
  if (status.pending) return 'connecting'
  if (status.cached) return `cached · connects on first use · ${status.toolCount} tools`
  return `✔ connected · ${status.toolCount} tools`
}

/** The `/mcp` reply for these rows; pure, so the wording is testable without a session. */
export function renderMcpListing(rows: readonly McpListingRow[]): string {
  if (rows.length === 0)
    return 'No MCP servers configured. Add one in the Store (manual form, paste a `mcpServers` JSON blob, or a one-line `npx …` command).'
  return [
    '**MCP servers** — tools appear in chat as `mcp_<server>_<tool>`:',
    '',
    ...rows.map((row) => {
      const facts = [row.transport, row.scope].filter(Boolean).join(', ')
      const state = row.enabled ? statusText(row.status) : 'disabled'
      const detail = row.detail ? ` — ${row.detail}` : ''
      return `- \`${row.label}\` _(${facts})_ · ${state}${detail}`
    }),
  ].join('\n')
}

/**
 * Handles `/mcp`: the MCP servers the session can reach — the person's own (global + project)
 * and those of its enabled plugins, under Claude Code's `plugin:<plugin>:<server>` name — each
 * with the outcome of its latest connection. Pure listing: it never connects (a down server
 * would block); the Store page's "Test" button does a live tool probe.
 */
export async function handleMcpControlCommand(
  ctx: Pick<CommandHandlerContext, 'mcpRepo' | 'deps' | 'pluginService'>,
  userId: string,
  session: SessionRecord,
  directReply: DirectReply,
): Promise<MessageMutationResponse> {
  const projectId = session.projectId ?? ''
  const [servers, availability, plugins] = await Promise.all([
    ctx.mcpRepo.listForScope(userId, projectId),
    // The listing states availability, and availability is a rule now — the record it
    // reads no longer carries one.
    readAvailability(ctx.deps.db, {
      userId,
      agentId: session.agents?.[0]?.agentId || DEFAULT_AGENT_ID,
    }),
    // A plugin listing that fails leaves the person's own servers listed.
    ctx.pluginService
      .listPlugins(userId, { projectId })
      .then((r) => r.plugins)
      .catch(() => []),
  ])
  const enabled = (name: string) => availability.effectFor('mcp', name) !== 'deny'
  const status = (id: string) => mcpClientManager.serverStatus({ userId, id })
  const rows: McpListingRow[] = [
    ...servers.map((s): McpListingRow => {
      const detail =
        s.transport === 'stdio'
          ? ((s.config.command as string[] | undefined) ?? []).join(' ')
          : ((s.config.url as string | undefined) ?? '')
      return {
        label: s.name,
        transport: s.transport,
        scope: s.projectId ? 'project' : 'global',
        detail: detail || 'no config',
        enabled: enabled(s.name),
        status: status(s.id),
      }
    }),
    // A plugin's server registers as `plugin:<plugin>:<server>` (plugins/mcp.ts builds that id).
    ...plugins
      .filter((plugin) => plugin.enabled)
      .flatMap((plugin) =>
        plugin.provides.mcpServers.map((server): McpListingRow => {
          return {
            label: `plugin:${plugin.name}:${server}`,
            scope: 'plugin',
            // An availability rule names the record: `mcp:<plugin>_<server>`.
            enabled: enabled(`${plugin.name}_${server}`),
            status: status(`plugin:${plugin.name}:${server}`),
          }
        }),
      ),
  ]
  return directReply(renderMcpListing(rows))
}
