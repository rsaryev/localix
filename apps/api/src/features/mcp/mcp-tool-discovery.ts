import type { McpJsonSchema } from '@localixai/agent/agents'
import { textEncoderByteLength } from '@localixai/agent'
import { errorMessage } from '../../lib/errors'
import type { McpClientLike, McpToolDef } from './mcp-client-contracts'
import { readMaxResultChars } from './mcp-tools'
import { resolveConnectTimeoutMs } from './mcp-timeouts'

/**
 * Most tools one server may contribute, and the largest input schema one of them may carry.
 *
 * Both bound things a server declares that reach EVERY model request, not just the call that
 * produced them: a tool definition is part of the request prefix, so 10_000 tools or a 5 MB
 * schema is a per-request cost paid forever. The list arrived uncapped and the schema arrived as
 * a bare `as McpJsonSchema` cast — no count, no size, no validation. Descriptions were already
 * bounded (`capDescription`), which is what made the other two read as oversights rather than a
 * policy.
 *
 * Generous on purpose: real servers expose tens of tools, and a schema past 128 KiB is not a
 * schema a model can use. Over-limit tools are DROPPED rather than truncated — a truncated JSON
 * Schema is not a schema — and every drop is logged, because a silently shorter tool list looks
 * exactly like a server that offers less.
 */
const MAX_TOOLS_PER_SERVER = 256
const MAX_TOOL_SCHEMA_BYTES = 128 * 1024

/** Re-list a running server's tools (after a `tools/list_changed` notification). */
export async function listToolDefs(client: McpClientLike): Promise<McpToolDef[]> {
  const listed = await client.listTools(undefined, { timeout: resolveConnectTimeoutMs() })
  const all = listed.tools ?? []
  const kept = all.slice(0, MAX_TOOLS_PER_SERVER)
  if (all.length > kept.length) {
    console.warn(
      `[mcp] server advertised ${all.length} tools; keeping the first ${kept.length}. ` +
        'Every tool definition rides every model request, so the rest are dropped.',
    )
  }
  const oversized: string[] = []
  const defs = kept.flatMap((def): McpToolDef[] => {
    const schemaBytes = def.inputSchema ? textEncoderByteLength(JSON.stringify(def.inputSchema)) : 0
    if (schemaBytes > MAX_TOOL_SCHEMA_BYTES) {
      oversized.push(`${def.name} (${schemaBytes} bytes)`)
      return []
    }
    return [
      {
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema as McpJsonSchema,
        annotations: def.annotations,
        _meta: def._meta,
        maxResultChars: readMaxResultChars(def),
      },
    ]
  })
  if (oversized.length > 0) {
    console.warn(
      `[mcp] dropped ${oversized.length} tool(s) whose input schema exceeds ` +
        `${MAX_TOOL_SCHEMA_BYTES} bytes: ${oversized.join(', ')}`,
    )
  }
  return defs
}

/**
 * Retry a capability-discovery call (tools/list) up to 3× on TRANSIENT errors
 * with short backoff — CC parity (v2.1.191). Auth/4xx/timeout are not retried;
 * we retry only clearly-transient network/5xx signals, else fail fast.
 */
export async function withDiscoveryRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg = errorMessage(err).toLowerCase()
      const transient =
        /econnreset|econnrefused|etimedout|socket hang up|fetch failed|network|\b5\d\d\b|temporarily/.test(
          msg,
        )
      if (!transient || attempt === 2) throw err
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)))
    }
  }
  throw lastErr
}
