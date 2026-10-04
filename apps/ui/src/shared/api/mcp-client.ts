import { client, unwrap, assertOk } from './internal'
import type { McpServerRecord, McpServerInput, McpProbeResult, McpImportResult } from './contracts'

/**
 * MCP server management: list/create/delete/test configured servers and bulk
 * import from a Claude-desktop-style `mcpServers` map. Spread into
 * `backendClient`.
 */
export const mcpApi = {
  async createMcpServer(input: McpServerInput): Promise<McpServerRecord> {
    // The UI's McpServerConfig is intentionally loose (the form builds it up
    // incrementally), while the route infers the strict stdio|http discriminated
    // union. The payload is validated by zod server-side, so cast at this boundary.
    return unwrap<McpServerRecord>(await client.rpc.mcp.servers.$post({ json: input as never }))
  },

  /** Edit an existing DB server BY ID (rename-safe — never duplicates the row). */
  async updateMcpServer(id: string, input: McpServerInput): Promise<McpServerRecord> {
    return unwrap<McpServerRecord>(
      await client.rpc.mcp.servers[':id'].$put({ param: { id }, json: input as never }),
    )
  },

  async deleteMcpServer(id: string): Promise<void> {
    const response = await client.rpc.mcp.servers[':id'].$delete({ param: { id } })
    await assertOk(response)
  },

  async testMcpServer(id: string): Promise<McpProbeResult> {
    return unwrap<McpProbeResult>(
      await client.rpc.mcp.servers[':id'].test.$post({
        param: { id },
      }),
    )
  },

  async importMcpServers(
    mcpServers: Record<string, Record<string, unknown>>,
    opts?: { projectId?: string | null; defaultEnabled?: boolean },
  ): Promise<McpImportResult> {
    return unwrap<McpImportResult>(
      await client.rpc.mcp.servers.import.$post({
        json: {
          mcpServers,
          projectId: opts?.projectId ?? null,
          defaultEnabled: opts?.defaultEnabled,
        },
      }),
    )
  },

  /**
   * Begin an interactive OAuth sign-in for a remote server. Returns the browser
   * authorization URL to open (absent when already authenticated).
   */
  async startMcpServerOAuth(
    id: string,
  ): Promise<{ authorizationUrl?: string; authenticated?: boolean; state?: string }> {
    return unwrap<{ authorizationUrl?: string; authenticated?: boolean; state?: string }>(
      await client.rpc.mcp.servers[':id'].oauth.start.$post({ param: { id } }),
    )
  },

  /** Forget a remote server's stored OAuth tokens (sign out). */
  async logoutMcpServerOAuth(id: string): Promise<void> {
    const response = await client.rpc.mcp.servers[':id'].oauth.logout.$post({ param: { id } })
    await assertOk(response)
  },
}
