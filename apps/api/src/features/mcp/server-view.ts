import { mcpOAuthStore } from './oauth/runtime'
import type { McpServerRecord } from './repository'
import type { McpServer } from './contracts'

/**
 * How a stored MCP server becomes the record the wire carries.
 *
 * Split out of the service because both are pure reads: the service owns writes, scopes
 * and the rule store, while these two only reshape a row. `enabled` arrives as an
 * ARGUMENT — it is a rule composed across global / project / agent, and this row has not
 * carried it since that move.
 */

export function toApi(
  record: McpServerRecord,
  enabled: boolean,
  oauthStatus: McpServer['oauthStatus'] = 'none',
): McpServer {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    transport: record.transport,
    projectId: record.projectId,
    enabled,
    config: record.config as McpServer['config'],
    oauthStatus,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** OAuth sign-in status for a remote (http) server: authenticated when tokens are stored. */
export async function oauthStatusFor(record: McpServerRecord): Promise<McpServer['oauthStatus']> {
  if (record.transport !== 'http') return 'none'
  return (await mcpOAuthStore.hasTokens(record.userId, record.id))
    ? 'authenticated'
    : 'unauthenticated'
}
