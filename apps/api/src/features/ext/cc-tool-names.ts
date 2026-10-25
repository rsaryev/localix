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
 * has no entry in the name table (the legacy names, the names a hook sees a
 * shaped tool's calls under, and every built-in by its own name) —
 * this is used for frontmatter `tools`/`disallowedTools` list normalization.
 * The `dropUnknown` policy: unmapped CC tools are dropped; all-unmapped → undefined = the
 * role's default tool surface.
 *
 * Pure module — no chat/UI imports, Node built-ins only via the type layer.
 */
import { BUILTIN_TOOL_NAMES } from '../agent-core/tool-names'
import { claudeCodeNames, shapedToolNames } from './cc-tool-shapes'

/**
 * Claude Code's older and file-level names, which no call of a shaped tool carries as its own
 * name: `LS`, `MultiEdit`, `NotebookRead`, `Task` … `cc-hooks/matcher.ts` keeps matching these as
 * legacy candidates; the per-call names live with the shapes (`cc-tool-shapes.ts`).
 */
export const CC_LEGACY_TOOL_NAMES: Readonly<Record<string, string>> = {
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
  // Both CC web primitives converge on the one composite, keyless research
  // capability. It accepts known URLs as well as search queries, so neither
  // imported declaration loses its underlying authority.
  webfetch: 'research',
  websearch: 'research',
  askuserquestion: 'ask',
  // CC `Agent` (formerly `Task`) spawns subagents; the engine's is `delegate`. Its type allowlist
  // (`Agent(worker)`) is not part of the tool name: an agent file's `tools` list keeps it apart
  // (`delegableAgentTypes` in `plugins/discovery-cc-files.ts`).
  agent: 'delegate',
  task: 'delegate',
}

/**
 * Tools no `tools` list switches off: the run's own plumbing, not a capability an author grants.
 * `tool_output` is the recovery path an elided result points at; `activate_tools` (Claude Code's
 * `ToolSearch`) loads the deferred tools the list already allows, MCP tools included, so
 * without it a list naming `mcp__server__tool` could not reach it; `context_budget`,
 * `set_topic` and `skip_answer` only report on or label the conversation. Every other tool is
 * Localix-only (`plan`, `loops`, `workflow`, `jobs`, `browser` …) and goes off with a list that
 * does not name it, as Claude Code's exact `tools` list does.
 */
export const CC_ALWAYS_ON_TOOLS: readonly string[] = [
  'activate_tools',
  'tool_output',
  'context_budget',
  'set_topic',
  'skip_answer',
]

/**
 * Every name a tool list may use → the engine tool it names. One table: the legacy names above,
 * each shaped tool's own name and every Claude Code name a hook sees its calls under
 * (`claudeCodeNames`), and each built-in by its own name. A name two tools answer to resolves to
 * the first (`TaskStop` is `jobs`', as for a hook; stopping a child run needs `delegate`).
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
  notebookedit: '`NotebookEdit` → mapped to `edit` (no notebook-cell tool; edits the .ipynb JSON)',
  grep: '`Grep` → mapped to `search`, which is also `Glob`: listing files and searching them share one grant',
  glob: '`Glob` → mapped to `search`, which is also `Grep`: listing files and searching them share one grant',
  webfetch: '`WebFetch` → mapped to `research`, which also searches the web',
  websearch: '`WebSearch` → mapped to `research`, which also fetches pages',
  sendmessage:
    '`SendMessage` → mapped to `delegate`, whose other actions start and stop child agents: there is no per-action grant',
  taskstop:
    '`TaskStop` → mapped to `jobs` (list, read, stop background jobs); stopping a child agent run belongs to `delegate`',
  monitor:
    "`Monitor` → mapped to `bash`, whose `until` waits on a command; it grants the shell as Claude Code's Monitor does",
  exitplanmode: '`ExitPlanMode` → mapped to `plan`, which also writes and reads plan documents',
  todowrite:
    '`TodoWrite` has no core tool: a task board is a plugin or mini app tool, so it is dropped',
  todoread:
    '`TodoRead` has no core tool: a task board is a plugin or mini app tool, so it is dropped',
  taskcreate: '`TaskCreate` has no core tool (task board): dropped',
  taskupdate: '`TaskUpdate` has no core tool (task board): dropped',
  tasklist: '`TaskList` has no core tool (task board): dropped',
  taskget: '`TaskGet` has no core tool (task board): dropped',
  taskoutput: '`TaskOutput` has no core tool: read a background job with `jobs`; dropped',
  enterplanmode: '`EnterPlanMode` has no equivalent: Localix has no plan mode to enter; dropped',
  lsp: '`LSP` has no equivalent: Localix has no language-server tool; use `search` and `read`; dropped',
  enterworktree: '`EnterWorktree` has no equivalent: worktrees are made with `bash`; dropped',
  exitworktree: '`ExitWorktree` has no equivalent: worktrees are left with `bash`; dropped',
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
  // permissions.md: "`mcp__puppeteer` matches any tool provided by the `puppeteer` server".
  if (tool === undefined && !wildcard) return `mcp_${server}_*`.replace(/[^a-zA-Z0-9_*]/g, '_')
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
