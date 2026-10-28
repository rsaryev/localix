/**
 * The arguments of an `mcp_tool` hook: its `input`, with every string value's `${path}` read
 * from the hook's own JSON input (hooks.md, MCP tool hook fields: `"${tool_input.file_path}"`).
 *
 * The page names only that one form, so the rest is this host's reading: a path walks object
 * keys and array indexes with dots, a path with no value reads as an empty string, and a value
 * that is not a string is written as text (an object as JSON). Strings inside nested objects
 * and arrays are substituted too; numbers, booleans and null stay as they are.
 */
import { isRecord } from '../../lib/record'

const PLACEHOLDER = /\$\{([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\}/g

function valueAt(root: unknown, path: string): unknown {
  let current = root
  for (const key of path.split('.')) {
    if (Array.isArray(current)) current = current[Number(key)]
    else if (isRecord(current)) current = current[key]
    else return undefined
  }
  return current
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** `input` with each string's `${path}` replaced from `hookInput`; absent `input` → `{}`. */
export function mcpToolArguments(
  input: Record<string, unknown> | undefined,
  hookInput: unknown,
): Record<string, unknown> {
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string')
      return value.replace(PLACEHOLDER, (_all, path: string) => asText(valueAt(hookInput, path)))
    if (Array.isArray(value)) return value.map(walk)
    if (isRecord(value))
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]))
    return value
  }
  return input ? (walk(input) as Record<string, unknown>) : {}
}
