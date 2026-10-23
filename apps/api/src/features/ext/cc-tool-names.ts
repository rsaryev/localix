/**
 * Canonical Claude Code → engine tool-name normalization.
 *
 * Single source of truth for the CC→engine name mapping, replacing the
 * previously duplicated/divergent implementations in discovery.ts and
 * validate.ts.
 *
 * ## Unknown-name policy
 * `normalizeCcToolName` passes unknown names through as their lowercased input
 * so engine tool names used directly (`"bash"`, `"read"`) continue to work.
 * `mapCcToolList` with `{ dropUnknown: true }` silently drops any token that
 * has no entry in CC_TOOL_NAME_MAP AND is not already a known engine name —
 * this is used for frontmatter `tools`/`disallowedTools` list normalization.
 * The `dropUnknown` policy: unmapped CC tools are dropped; all-unmapped → undefined = the
 * role's default tool surface.
 *
 * Pure module — no chat/UI imports, Node built-ins only via the type layer.
 */

/** Maps a lowercased CC tool name to its engine equivalent. */
export const CC_TOOL_NAME_MAP: Readonly<Record<string, string>> = {
  // File system
  read: 'read',
  write: 'write',
  edit: 'edit',
  multiedit: 'edit', // `edit`'s `edits` array is MultiEdit natively (several edits, in order)
  bash: 'bash',
  grep: 'search',
  glob: 'search',
  ls: 'search',
  // CC notebook / shell tools → closest engine equivalents
  notebookread: 'read', // reads notebook cells → read
  notebookedit: 'edit', // edits notebook cells → edit on the .ipynb JSON
  // `KillShell` / `BashOutput` (now TaskStop / TaskOutput) stop or read a background job; neither
  // runs a command, so they stay unmapped. Mapping them to `bash` handed an agent whose author
  // made it read-only the whole shell.
  // CC `Skill` invokes skills; leaving it out of a subagent's `tools` switches skills off (CC).
  skill: 'skill',
  // CC task management (TodoWrite/TodoRead, TaskCreate/TaskUpdate/TaskList/TaskGet) and team
  // lifecycle (TeamCreate/TeamDelete) have no core equivalent: a task board is a plugin's tool,
  // and naming one here would make core resolve a CC name to a plugin it cannot know is there.
  // They stay unmapped, so a frontmatter list drops them.
  // Both CC web primitives converge on the one composite, keyless research
  // capability. It accepts known URLs as well as search queries, so neither
  // imported declaration loses its underlying authority.
  webfetch: 'research',
  websearch: 'research',
  // CC HITL. `EnterPlanMode`/`ExitPlanMode` have no equivalent: this engine has no plan
  // mode and no plan tool, so they stay unmapped and a frontmatter list drops them.
  askuserquestion: 'ask',
}

/**
 * CC tool names that map to engine equivalents but with semantic differences.
 * Used by validators to emit informational warnings when a manifest author
 * ports a CC tool allowlist directly.
 */
export const CC_SEMANTIC_GAPS: Readonly<Record<string, string>> = {
  notebookedit: '`NotebookEdit` → mapped to `edit` (no notebook-cell tool; edits the .ipynb JSON)',
  // WebFetch/WebSearch both map to research; its input supports both URLs and queries.
}

/**
 * Strip YAML quotes and CC pattern syntax from a raw token.
 * e.g. `"Bash(git *)"` → `bash`, `'Read'` → `read`
 */
function stripCcToken(raw: string): string {
  return raw
    .replace(/^["']|["']$/g, '')
    .replace(/\(.*$/, '')
    .trim()
}

/**
 * Map a Claude Code MCP tool name (`mcp__<server>__<tool>`) to the engine's
 * namespaced form (`mcp_<server>_<tool>`), or `undefined` when the token is not
 * an MCP name. Localix emits `mcp_<server>_<tool>` (single underscore, non-word
 * chars sanitized to `_`); CC uses the double-underscore form. Accepting the CC
 * form as an alias lets a ported `allowed-tools` / permission rule keep matching
 * without renaming any live tool. Case is PRESERVED (server/tool names are not
 * lowercased by the engine).
 *
 * A plugin's server is `plugin_<plugin>_<server>` in Claude Code's address and the record
 * `<plugin>_<server>` here (`plugins/mcp.ts`), so `mcp__plugin_p_s__t` → `mcp_p_s_t`. A trailing
 * `*` (`mcp__<server>__*`, every tool of a server) is kept: `mcp_<server>_*`.
 */
export function normalizeMcpToolAlias(name: string): string | undefined {
  if (!name.startsWith('mcp__')) return undefined
  const wildcard = name.endsWith('*')
  const address = name.slice('mcp__'.length, wildcard ? -1 : undefined)
  // The server ends at the first `__`; the tool keeps any `__` of its own, as the engine does.
  const split = address.indexOf('__')
  const server = (split < 0 ? address : address.slice(0, split)).replace(/^plugin_/, '')
  const tool = split < 0 ? undefined : address.slice(split + 2)
  // The same sanitization the engine's `namespacedName` applies (`mcp/mcp-tools.ts`).
  const engine = `mcp_${server}${tool === undefined ? '' : `_${tool}`}`.replace(
    /[^a-zA-Z0-9_]/g,
    '_',
  )
  return wildcard ? `${engine}*` : engine
}

/**
 * Map a single CC tool name (case-insensitive) to its engine equivalent.
 * Returns the engine name when known; the lowercased input otherwise (so
 * engine names like `"bash"` pass through unchanged). MCP names in the CC
 * `mcp__server__tool` form are aliased to the engine's `mcp_server_tool`.
 */
export function normalizeCcToolName(name: string): string {
  const bare = stripCcToken(name)
  const mcpAlias = normalizeMcpToolAlias(bare)
  if (mcpAlias) return mcpAlias
  // An engine MCP name keeps its case: `mcp_GitHub_getIssue` is not `mcp_github_getissue`.
  if (bare.startsWith('mcp_')) return bare
  const lower = bare.toLowerCase()
  return CC_TOOL_NAME_MAP[lower] ?? lower
}

/**
 * Map a list of CC (or engine) tool name strings to engine names.
 *
 * @param list - Array of raw tool name tokens (may contain CC names, engine
 *   names, YAML-quoted strings, or CC pattern syntax like `Bash(git *)`).
 * @param opts.dropUnknown - When `true` (the default for frontmatter lists),
 *   tokens that have no entry in CC_TOOL_NAME_MAP AND are not a direct engine
 *   name match are silently dropped. When `false`, unknown tokens are passed
 *   through lowercased (same as `normalizeCcToolName`).
 * @returns Deduplicated list of engine tool names.
 */
export function mapCcToolList(list: string[], opts: { dropUnknown: boolean }): string[] {
  const out: string[] = []
  for (const raw of list) {
    const bare = stripCcToken(raw)
    // A Claude Code MCP address becomes the engine's name; an engine MCP name stays as written.
    const mcpAlias = normalizeMcpToolAlias(bare) ?? (bare.startsWith('mcp_') ? bare : undefined)
    if (mcpAlias) {
      if (!out.includes(mcpAlias)) out.push(mcpAlias)
      continue
    }
    const lower = bare.toLowerCase()
    const mapped = CC_TOOL_NAME_MAP[lower]
    if (mapped) {
      if (!out.includes(mapped)) out.push(mapped)
    } else if (!opts.dropUnknown) {
      if (!out.includes(lower)) out.push(lower)
    }
    // dropUnknown=true: silently drop tokens with no mapping
  }
  return out
}

/**
 * Classify a tool name token from the perspective of the engine.
 *
 * - `'engine'`  — the lowercased token is already a valid engine tool name
 *   (caller is responsible for checking against BUILTIN_TOOL_NAMES).
 * - `'cc-gap'`  — the token maps to an engine tool but with semantic differences
 *   (see CC_SEMANTIC_GAPS); a validation warning is appropriate.
 * - `'cc'`      — the token maps cleanly to an engine equivalent with no known gap.
 * - `'unknown'` — not recognized in CC_TOOL_NAME_MAP; the caller decides what to do.
 *
 * The raw token is stripped of YAML quoting and CC pattern syntax before classification.
 */
export function classifyToolName(name: string): 'engine' | 'cc-gap' | 'cc' | 'unknown' {
  const bare = stripCcToken(name)
  const lower = bare.toLowerCase()
  if (CC_SEMANTIC_GAPS[lower]) return 'cc-gap'
  const mapped = CC_TOOL_NAME_MAP[lower]
  if (!mapped) return 'unknown'
  // If the mapped name equals the input (e.g. "bash"→"bash"), it's already an engine name.
  if (mapped === lower) return 'engine'
  return 'cc'
}
