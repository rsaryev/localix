import type { z } from 'zod'

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

/**
 * Bridge an MCP tool's JSON Schema into something that satisfies
 * `AgentTool.inputSchema` (typed `z.ZodType`) WITHOUT a full JSON-Schema→Zod
 * conversion.
 *
 * Our runtime only ever consumes `inputSchema` two ways:
 *   1. `zodToJsonSchema()` (packages/agent/src/utils/zod-schema.ts) — calls
 *      `.toJSONSchema()` to send the schema to the provider.
 *   2. The agent loop (loop.ts) — calls `.safeParse(args)` to validate tool input.
 *
 * So we hand-roll a tiny object implementing exactly those two methods and cast
 * it to `z.ZodType`. The MCP server performs authoritative argument validation
 * on its side, so `safeParse` here is intentionally permissive: it accepts any
 * object (rejecting only non-object payloads) and passes the args through. This
 * is the localix-idiomatic equivalent of the `ai` SDK's `jsonSchema(schema)` +
 * `dynamicTool` pattern, kept dependency-free.
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

  const bridge = {
    /** Used by zodToJsonSchema() to serialize the schema for the provider. */
    toJSONSchema(): Record<string, unknown> {
      return schema
    },
    /** Used by the agent loop to validate tool input before execution. */
    safeParse(value: unknown):
      | { success: true; data: Record<string, unknown> }
      | {
          success: false
          error: { message: string; issues: Array<{ path: (string | number)[]; message: string }> }
        } {
      if (value === undefined || value === null) {
        return { success: true, data: {} }
      }
      if (typeof value !== 'object' || Array.isArray(value)) {
        const message = 'Expected an object of tool arguments'
        return {
          success: false,
          error: { message, issues: [{ path: [], message }] },
        }
      }
      return { success: true, data: value as Record<string, unknown> }
    },
  }

  return bridge as unknown as z.ZodType<Record<string, unknown>>
}
