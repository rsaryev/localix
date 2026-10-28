/**
 * Canonical Claude Code → engine tool-name normalization.
 *
 * Single source of truth for the CC→engine name mapping, replacing the
 * previously duplicated/divergent implementations in discovery.ts and
 * validate.ts.
 *
 * ## Unknown-name policy
 * `normalizeCcToolName` passes unknown names through as their lowercased input
 * so the names of mini app and plugin tools (`chess`) continue to work.
 * `mapCcToolList` with `{ dropUnknown: true }` silently drops any token that
 * has no entry in the name table (the legacy names, the names a hook sees a
 * shaped tool's calls under, and every built-in by its own name) —
 * this is used for frontmatter `tools`/`disallowedTools` list normalization.
 * The `dropUnknown` policy: unmapped CC tools are dropped; all-unmapped → undefined = the
 * role's default tool surface.
 *
 * Pure module — no chat/UI imports, Node built-ins only via the type layer.
 */
import { normalizeMcpToolAlias } from '../agent-core/mcp-tool-alias'
import { BUILTIN_TOOL_NAMES } from '../agent-core/tool-names'
import { claudeCodeNames, shapedToolNames } from './cc-tool-shapes'

/**
 * Claude Code's older and file-level names, which no call of a shaped tool carries as its own
 * name: `LS`, `MultiEdit`, `NotebookRead`, `Task` … `cc-hooks/matcher.ts` keeps matching these as
 * legacy candidates; the per-call names live with the shapes (`cc-tool-shapes.ts`).
 */
export const CC_LEGACY_TOOL_NAMES: Readonly<Record<string, string>> = {
  // File system
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  multiedit: 'Edit', // `Edit`'s `edits` array is MultiEdit natively (several edits, in order)
  bash: 'Bash',
  grep: 'Search',
  glob: 'Search',
  ls: 'Search',
  // CC notebook / shell tools → closest engine equivalents
  notebookread: 'Read', // reads notebook cells → Read
  notebookedit: 'Edit', // edits notebook cells → Edit on the .ipynb JSON
  // `KillShell` (now `TaskStop`) stops a background job, as `TaskStop` does here; `BashOutput`
  // (now `TaskOutput`) reads one and stays unmapped. Mapping either to `bash` handed an agent whose
  // author made it read-only the whole shell.
  killshell: 'TaskStop',
  // CC `Skill` invokes skills; leaving it out of a subagent's `tools` switches skills off (CC).
  skill: 'Skill',
  // Both CC web primitives converge on the one composite, keyless research
  // capability. It accepts known URLs as well as search queries, so neither
  // imported declaration loses its underlying authority.
  webfetch: 'Research',
  websearch: 'Research',
  askuserquestion: 'AskUserQuestion',
  // CC `Agent` (formerly `Task`) starts subagents, as `Agent` does here. Its type allowlist
  // (`Agent(worker)`) is not part of the tool name: an agent file's `tools` list keeps it apart
  // (`delegableAgentTypes` in `plugins/discovery-cc-files.ts`).
  task: 'Agent',
}

/**
 * Tools no `tools` list switches off: the run's own plumbing, not a capability an author grants.
 * `ToolOutput` is the recovery path an elided result points at; `ToolSearch` loads the deferred
 * tools the list already allows, MCP tools included, so without it a list naming
 * `mcp__server__tool` could not reach it; `ContextBudget` only reports on the conversation. Every other tool is Localix-only (`Plan`, `Loops`, `Workflow`, `Jobs`,
 * `Browser` …) and goes off with a list that does not name it, as Claude Code's exact `tools` list
 * does.
 */
export const CC_ALWAYS_ON_TOOLS: readonly string[] = ['ToolSearch', 'ToolOutput', 'ContextBudget']

/**
 * Every name a tool list may use → the engine tool it names. One table: the legacy names above,
 * each shaped tool's own name and every Claude Code name a hook sees its calls under
 * (`claudeCodeNames`), and each built-in by its own name. A name two tools answer to resolves to
 * the first.
 */
const NAME_TABLE: Readonly<Record<string, string>> = (() => {
  const table: Record<string, string> = { ...CC_LEGACY_TOOL_NAMES }
  const add = (name: string, local: string) => {
    const key = name.toLowerCase()
    if (table[key] === undefined) table[key] = local
  }
  for (const local of shapedToolNames()) {
    add(local, local)
    for (const name of claudeCodeNames(local)) add(name, local)
  }
  for (const local of BUILTIN_TOOL_NAMES) add(local, local)
  return table
})()

/**
 * The tool names a `tools` list switches off when it leaves them out: every name above, but the
 * always-on infrastructure, which a list never removes (`plugin-main-agent.ts` reads the values).
 */
export const CC_TOOL_NAME_MAP: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(NAME_TABLE).filter(([, engine]) => !CC_ALWAYS_ON_TOOLS.includes(engine)),
)

const lookupName = (lower: string): string | undefined => NAME_TABLE[lower]

/**
 * CC tool names that map to engine equivalents but with semantic differences, and CC tools with
 * no equivalent. Used by validators to emit informational warnings when a manifest author ports a
 * CC tool allowlist directly. Docs: docs/extending/claude-code-plugins.md ("Tool names").
 */
export const CC_SEMANTIC_GAPS: Readonly<Record<string, string>> = {
  notebookedit: '`NotebookEdit` → mapped to `Edit` (no notebook-cell tool; edits the .ipynb JSON)',
  grep: '`Grep` → mapped to `Search`, which is also `Glob`: listing files and searching them share one grant',
  glob: '`Glob` → mapped to `Search`, which is also `Grep`: listing files and searching them share one grant',
  webfetch: '`WebFetch` → mapped to `Research`, which also searches the web',
  websearch: '`WebSearch` → mapped to `Research`, which also fetches pages',
  monitor:
    "`Monitor` → mapped to `Bash`, whose `until` waits on a command; it grants the shell as Claude Code's Monitor does",
  exitplanmode: '`ExitPlanMode` → mapped to `Plan`, which also writes and reads plan documents',
  todowrite:
    '`TodoWrite` has no core tool: a task board is a plugin or mini app tool, so it is dropped',
  todoread:
    '`TodoRead` has no core tool: a task board is a plugin or mini app tool, so it is dropped',
  taskcreate: '`TaskCreate` has no core tool (task board): dropped',
  taskupdate: '`TaskUpdate` has no core tool (task board): dropped',
  tasklist: '`TaskList` has no core tool (task board): dropped',
  taskget: '`TaskGet` has no core tool (task board): dropped',
  taskoutput: '`TaskOutput` has no core tool: read a background job with `Jobs`; dropped',
  enterplanmode: '`EnterPlanMode` has no equivalent: Localix has no plan mode to enter; dropped',
  lsp: '`LSP` has no equivalent: Localix has no language-server tool; use `Search` and `Read`; dropped',
  enterworktree: '`EnterWorktree` has no equivalent: worktrees are made with `Bash`; dropped',
  exitworktree: '`ExitWorktree` has no equivalent: worktrees are left with `Bash`; dropped',
  pushnotification: '`PushNotification` has no equivalent tool; dropped',
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
  return lookupName(lower) ?? lower
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
    const mapped = lookupName(lower)
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
 * Map an `allowed-tools` or `disallowed-tools` list to engine names, keeping each
 * `Tool(specifier)` pattern: `Bash(git add:*)` pre-approves `git add` only, `Bash(rm *)` denies
 * `rm` commands only, never the whole shell. The permission gate reads the pattern
 * (`skillPermissionRules`, `claudeCodeDenyRules`); a bare name is the whole tool.
 */
export function mapCcRuleList(list: string[]): string[] {
  const out: string[] = []
  for (const raw of list) {
    const token = raw.replace(/^["']|["']$/g, '').trim()
    const pattern = token.match(/^([^(]+)\((.+)\)$/)
    const mapped = pattern
      ? mapCcToolList([pattern[1]!], { dropUnknown: true }).map((name) => `${name}(${pattern[2]})`)
      : mapCcToolList([token], { dropUnknown: true })
    for (const entry of mapped) if (!out.includes(entry)) out.push(entry)
  }
  return out
}

/**
 * Split a mapped denylist: `tools` are whole tools to switch off (a bare name, or `name(*)`);
 * `patterned` are the `name(specifier)` entries, which deny only what the pattern matches and
 * are turned into permission rows (`claudeCodeDenyRules`), never into a removed tool.
 */
export function splitDenyList(list: readonly string[]): { tools: string[]; patterned: string[] } {
  const tools: string[] = []
  const patterned: string[] = []
  for (const raw of list) {
    const token = raw.replace(/^["']|["']$/g, '').trim()
    const pattern = token.match(/^([^(]+)\((.*)\)$/s)
    if (pattern && pattern[2]!.trim() !== '*') {
      if (!patterned.includes(token)) patterned.push(token)
      continue
    }
    const [name] = mapCcToolList([pattern ? pattern[1]! : token], { dropUnknown: false })
    if (name && !tools.includes(name)) tools.push(name)
  }
  return { tools, patterned }
}
