import type { AgentTool } from '@localixai/agent/agents'

/**
 * Validate a hook's input rewrite against the tool's schema. Zod schemas (anything with
 * `safeParse`) are re-parsed — a failing rewrite is rejected. Non-zod schemas (e.g. MCP JSON
 * schemas) can't be re-parsed host-side; the rewrite is accepted as-is and the downstream tool
 * owns validation.
 */
export function reparseToolInput(
  tool: AgentTool,
  rewrite: unknown,
): { ok: true; input: unknown } | { ok: false; error: string } {
  const schema = tool.inputSchema as
    | {
        safeParse?: (v: unknown) => {
          success: boolean
          data?: unknown
          error?: { message?: string }
        }
      }
    | undefined
  if (!schema || typeof schema.safeParse !== 'function') return { ok: true, input: rewrite }
  const parsed = schema.safeParse(rewrite)
  if (parsed.success) return { ok: true, input: parsed.data }
  return { ok: false, error: parsed.error?.message ?? 'schema re-parse failed' }
}
