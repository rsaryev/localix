/**
 * unwrapMcpServersBlob — extract the `{ name: entry }` server map from a pasted
 * MCP config blob. Accepts every wrapper shape the ecosystem emits:
 *
 *   - `{ "mcpServers": { … } }` — Claude Desktop / Claude Code `.mcp.json`
 *   - `{ "servers": { … } }`    — VS Code `.vscode/mcp.json` / GitHub MCP registry
 *   - a bare `{ "<name>": { … } }` map
 *
 * Throws with a human-readable reason when the blob is not an object, when it
 * looks like a single server entry pasted without a name, or when a map value is
 * not an object — so paste flows can show WHY instead of a misleading per-entry
 * error (the classic failure: a VS Code `servers` wrapper read as a server named
 * "servers" → `local server is missing a "command"`).
 *
 * Dependency-free ON PURPOSE: exported as the `@localixai/api/mcp-import` leaf
 * (and via `client.ts`) so a client's paste flow shares this exact logic without
 * pulling server code (zod, kysely) into its bundle.
 */

const WRAPPER_KEYS = ['mcpServers', 'servers'] as const

export function unwrapMcpServersBlob(parsed: unknown): Record<string, Record<string, unknown>> {
  if (!isPlainObject(parsed)) {
    throw new Error('Expected a JSON object with MCP server definitions.')
  }
  for (const key of WRAPPER_KEYS) {
    const candidate = parsed[key]
    // A wrapper key whose value itself looks like a server entry is really a
    // bare map with a server unluckily named `servers` — fall through.
    if (isPlainObject(candidate) && !looksLikeServerEntry(candidate)) {
      return toServerMap(candidate)
    }
  }
  if (looksLikeServerEntry(parsed)) {
    throw new Error(
      'This looks like a single server entry — give it a name: {"mcpServers": {"my-server": { … }}}.',
    )
  }
  return toServerMap(parsed)
}

/** An object is a server ENTRY (not a map of entries) when it carries any of the
 *  connection fields every ecosystem format uses. */
function looksLikeServerEntry(obj: Record<string, unknown>): boolean {
  return (
    typeof obj.command === 'string' ||
    Array.isArray(obj.command) ||
    typeof obj.url === 'string' ||
    typeof obj.serverUrl === 'string'
  )
}

function toServerMap(obj: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const names = Object.keys(obj)
  if (names.length === 0) throw new Error('No servers found in the pasted JSON.')
  for (const name of names) {
    if (!isPlainObject(obj[name])) {
      throw new Error(
        `Expected {"mcpServers": {"<name>": { … }}} — "${name}" is not a server object.`,
      )
    }
  }
  return obj as Record<string, Record<string, unknown>>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
