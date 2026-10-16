import type { McpServerRecord } from './repository'
import {
  resolveConnectTimeoutMs,
  type McpResourceContent,
  type McpResourceDef,
  type McpResourceTemplateDef,
} from './mcp-wire'
import { collectResourcePages } from './mcp-resource-pages'
import type { ConnectionPool } from './mcp-connection-pool'

type Acquire = Pick<ConnectionPool, 'acquire'>

/**
 * List resources across the given servers (those advertising the capability),
 * reusing the cached clients from the last gather. Per-server failures are
 * swallowed so one bad server doesn't sink the whole listing.
 */
export async function listResources(
  pool: Acquire,
  servers: McpServerRecord[],
  cwd: string,
): Promise<Array<McpResourceDef & { server: string }>> {
  const resourcesByServer = await Promise.all(
    servers.map(async (server) => {
      try {
        const { connection } = await pool.acquire(server, cwd)
        if (!connection.client.getServerCapabilities?.()?.resources) return []

        const client = connection.client
        const list = client.listResources?.bind(client)
        if (!list) return []
        const resources = await collectResourcePages({
          serverName: server.name,
          operation: 'resources/list',
          async listPage(cursor) {
            const listed = await list(cursor === undefined ? undefined : { cursor }, {
              timeout: resolveConnectTimeoutMs(),
            })
            return { items: listed.resources ?? [], nextCursor: listed.nextCursor }
          },
        })
        return resources.map((resource) => ({ server: server.name, ...resource }))
      } catch {
        /* skip a failing server */
        return []
      }
    }),
  )
  return resourcesByServer.flat()
}

/** List resource URI templates, preserving SDK metadata and annotations. */
export async function listResourceTemplates(
  pool: Acquire,
  servers: McpServerRecord[],
  cwd: string,
): Promise<Array<McpResourceTemplateDef & { server: string }>> {
  const templatesByServer = await Promise.all(
    servers.map(async (server) => {
      try {
        const { connection } = await pool.acquire(server, cwd)
        if (!connection.client.getServerCapabilities?.()?.resources) return []

        const client = connection.client
        const list = client.listResourceTemplates?.bind(client)
        if (!list) return []
        const templates = await collectResourcePages({
          serverName: server.name,
          operation: 'resources/templates/list',
          async listPage(cursor) {
            const listed = await list(cursor === undefined ? undefined : { cursor }, {
              timeout: resolveConnectTimeoutMs(),
            })
            return {
              items: listed.resourceTemplates ?? [],
              nextCursor: listed.nextCursor,
            }
          },
        })
        return templates.map((template) => ({ server: server.name, ...template }))
      } catch {
        /* skip a failing server */
        return []
      }
    }),
  )
  return templatesByServer.flat()
}

/** Read one resource by uri from a named server (reusing its cached client). */
export async function readResource(
  pool: Acquire,
  servers: McpServerRecord[],
  cwd: string,
  serverName: string,
  uri: string,
): Promise<McpResourceContent[]> {
  const server = servers.find((s) => s.name === serverName)
  if (!server) throw new Error(`No connected MCP server named "${serverName}"`)
  const { connection } = await pool.acquire(server, cwd)
  if (!connection.client.readResource)
    throw new Error(`Server "${serverName}" does not support resources`)
  const result = await connection.client.readResource(
    { uri },
    { timeout: resolveConnectTimeoutMs() },
  )
  return result.contents ?? []
}
