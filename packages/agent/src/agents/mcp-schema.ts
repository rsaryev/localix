import { z } from 'zod'

/**
 * Minimal JSON Schema shape we accept from an MCP server's `tools/list`
 * (`inputSchema`). MCP guarantees an object schema; we only read the bits we
 * normalize.
 */
export interface McpJsonSchema {
  type?: string
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
  [key: string]: unknown
}

type SafeParseResult =
  | { success: true; data: Record<string, unknown> }
  | {
      success: false
      error: { message: string; issues: Array<{ path: PropertyKey[]; message: string }> }
    }

/**
 * A validator for the server's own schema, or null when zod cannot read it (an unresolved `$ref`,
 * an unsupported keyword) — the MCP server still validates authoritatively, so an unreadable
 * schema degrades to the object-shape check instead of blocking the tool.
 */
function argumentValidator(raw: McpJsonSchema | undefined): z.ZodType | null {
  if (!raw) return null
  const { $schema: _omit, ...schema } = raw as McpJsonSchema & { $schema?: unknown }
  try {
    return z.fromJSONSchema({ ...schema, type: 'object' } as Parameters<typeof z.fromJSONSchema>[0])
  } catch {
    return null
  }
}

function failure(issues: Array<{ path: PropertyKey[]; message: string }>): SafeParseResult {
  return {
    success: false,
    error: { message: issues.map((issue) => issue.message).join('; '), issues },
  }
}

/**
 * Bridge an MCP tool's JSON Schema into something that satisfies `AgentTool.inputSchema`
 * (typed `z.ZodType`).
 *
 * Our runtime only ever consumes `inputSchema` two ways:
 *   1. `zodToJsonSchema()` (packages/agent/src/utils/zod-schema.ts) — calls `.toJSONSchema()`
 *      to send the schema to the provider. The server's schema is sent as-is (normalized to a
 *      strict object), never round-tripped through zod, so no keyword is lost on the way.
 *   2. The agent loop (loop.ts) — calls `.safeParse(args)` to validate tool input. Arguments are
 *      checked against the server's schema (converted by `z.fromJSONSchema`), so a wrong type or a
 *      missing required field comes back to the model as a tool error with the zod issues. Extra
 *      keys are not rejected here: the server owns that call.
 */
export function mcpInputSchema(raw: McpJsonSchema | undefined): z.ZodType<Record<string, unknown>> {
  // Normalize to a strict object schema:
  // always type:"object", concrete properties, no surprise extra keys advertised.
  const normalized: McpJsonSchema = {
    ...raw,
    type: 'object',
    properties: (raw?.properties ?? {}) as Record<string, unknown>,
    additionalProperties: false,
  }
  const { $schema: _omit, ...schema } = normalized as McpJsonSchema & { $schema?: unknown }
  const validator = argumentValidator(raw)

  const bridge = {
    /** Used by zodToJsonSchema() to serialize the schema for the provider. */
    toJSONSchema(): Record<string, unknown> {
      return schema
    },
    /** Used by the agent loop to validate tool input before execution. */
    safeParse(value: unknown): SafeParseResult {
      const args = value === undefined || value === null ? {} : value
      if (typeof args !== 'object' || Array.isArray(args)) {
        return failure([{ path: [], message: 'Expected an object of tool arguments' }])
      }
      const checked = validator?.safeParse(args)
      if (checked && !checked.success) {
        return failure(checked.error.issues.map(({ path, message }) => ({ path, message })))
      }
      return { success: true, data: args as Record<string, unknown> }
    },
  }

  // The bridge implements exactly the two members the runtime calls (see above).
  return bridge as unknown as z.ZodType<Record<string, unknown>>
}
