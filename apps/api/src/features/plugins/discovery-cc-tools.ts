import { mapCcToolList } from '../ext/cc-tool-names'
import { splitTokenList } from '../agent-core/skill-discovery'

/** True for a non-null, non-array object (a YAML mapping node). */
export function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Translate a CC `tools` frontmatter value to engine tool names. Accepts
 * space/comma-separated strings and YAML inline arrays (`[Read, Bash]`).
 * Unknown CC tool names are dropped (dropUnknown policy).
 */
export function mapCcTools(rawValue: string | string[]): string[] {
  const tokens = splitTokenList(rawValue) ?? []
  return mapCcToolList(tokens, { dropUnknown: true })
}

/**
 * The types `Agent(worker, researcher)` in a `tools` list names (sub-agents.md): an allowlist of the
 * agents the main thread may spawn. A bare `Agent` or `Task` allows every type, so the list is then
 * absent; with typed entries only the named types are allowed.
 */
export function delegableAgentTypes(raw: string | string[] | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  const types: string[] = []
  for (const token of splitTokenList(raw) ?? []) {
    const typed = /^(?:agent|task)\((.*)\)$/is.exec(token.trim())
    if (typed) types.push(...(splitTokenList(typed[1]!.replace(/,/g, ' ')) ?? []))
  }
  return types.length ? [...new Set(types)] : undefined
}

/**
 * Map a CC tools field value to engine tool names, handling empty (`[]` = no tools).
 * Returns `undefined` when the field is absent or empty (→ inherit the role's default tool surface).
 * Returns `[]` only for an explicit YAML inline array `[]` (intentional no-tool surface).
 * Returns `undefined` when the list contains `*` (wildcard = all tools).
 * A list whose every name is unknown here (`TodoWrite`, `ExitPlanMode`) maps to `[]`: a `tools`
 * list is exact, so dropping its names must not widen it to the inherited surface.
 */
export function mapOptionalCcTools(raw: string | string[] | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  // Block-list path: already an array from parseMarkdownFrontmatter.
  if (Array.isArray(raw)) {
    if (raw.length === 0) return [] // explicit empty list → no-tool surface
    if (raw.includes('*')) return undefined // wildcard → inherit default
    return mapCcTools(raw)
  }
  const trimmed = raw.trim()
  if (trimmed === '') return undefined // empty/missing field → inherit default
  const stripped = trimmed.replace(/^\[|\]$/g, '').trim()
  if (stripped === '') return [] // explicit `[]` → no-tool surface
  // `*` or `["*"]` means "all tools" → inherit default.
  const tokens = splitTokenList(stripped) ?? []
  if (tokens.includes('*')) return undefined
  return mapCcTools(raw)
}
