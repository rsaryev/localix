/**
 * Claude Code hook matcher semantics.
 *
 * A matcher decides whether a hook group fires. Per the CC spec, how a matcher
 * is evaluated depends on its characters:
 *   - `'*'`, `''`, or omitted → match all
 *   - only letters/digits/`_`/`-`/spaces/`,`/`|` → exact string(s), split on `|` or `,`
 *   - anything else → a JavaScript regular expression (unanchored, `RegExp.test`)
 *
 * For tool events (`PreToolUse`/`PostToolUse`) the matcher tests the CC tool
 * NAME. Our built-in tools carry Claude Code's capitalized names (`Bash`, `Search`, `Edit`),
 * while CC also names some of their calls otherwise (`Grep`, `Glob`). We therefore match a
 * matcher against the FULL candidate set for a tool — its name plus every CC name that maps to
 * it (via the shared CC↔engine map).
 *
 * MCP tools: a matcher written in a CC name form is aliased to the engine form via
 * `ccMcpMatcherVariants` — `mcp__server__tool` matches our `mcp_server_tool`, and the
 * CC PLUGIN form `mcp__plugin_<plugin>_<server>__<tool>` matches our
 * `mcp_<plugin>_<server>_<tool>` (see ./mcp-names.ts). Engine-form matchers match
 * directly, unchanged. A caller that passes the tool's aliases (its Claude Code
 * `mcp__…` name) gets Claude Code's own matching instead: CC forms test that name as written.
 *
 * Pure module — no chat/UI imports.
 */
import { CC_LEGACY_TOOL_NAMES } from '../ext/cc-tool-names'
import { TOOL } from '../agent-core/tool-names'
import { claudeCodeNames, claudeCodeToolName } from '../ext/cc-tool-shapes'
import { ccMcpMatcherVariants } from './mcp-names'

/** Characters that keep a matcher on the "exact string(s)" path (no regex). */
const EXACT_ONLY = /^[A-Za-z0-9_\-, |]*$/

/** True when the matcher means "match every occurrence" (`*`, empty, or absent). */
export function isMatchAll(matcher: string | undefined): boolean {
  if (matcher === undefined) return true
  const trimmed = matcher.trim()
  return trimmed === '' || trimmed === '*'
}

/**
 * Split an exact-match matcher into its alternatives (on `|` or `,`), as written,
 * expanding each CC MCP name form with `variants` (mcp-names.ts).
 */
function exactAlternatives(matcher: string, variants: (token: string) => string[]): string[] {
  return matcher
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .flatMap(variants)
}

/**
 * How a CC MCP matcher token is tried. A tool that carries its Claude Code `mcp__…` name among
 * its candidates is matched by that name AS WRITTEN, as Claude Code matches it: the engine-form
 * rewrite would let `mcp__echo__.*` (`mcp_echo_.*`) match inside `mcp_lin_mcp_echo_echo`, and it
 * keeps the `-` of `mcp__plugin_lin-mcp_echo__.*` that the engine name turned into `_`. Only a
 * caller that knows the engine name alone gets the rewrites.
 */
function variantsFor(candidates: readonly string[]): (token: string) => string[] {
  return candidates.some((c) => c.startsWith('mcp__')) ? (token) => [token] : ccMcpMatcherVariants
}

/**
 * Match a matcher against a set of candidate names. Exact matchers compare
 * case-sensitively against each candidate; regex matchers `.test` each one —
 * a matcher whose source is a CC MCP name form is also tried with its engine-form
 * source rewrites (`mcp__…` → `mcp_…`), so CC-written regexes match live tools.
 */
function matchAny(
  matcher: string,
  candidates: readonly string[],
  /** What a regex matcher is tried against, where it is not every candidate. */
  regexCandidates: readonly string[] = candidates,
): boolean {
  if (isMatchAll(matcher)) return true
  const variants = variantsFor(candidates)
  if (EXACT_ONLY.test(matcher)) {
    // Case-sensitive, as in Claude Code: `Bash` matches the Bash tool, `bash` only the engine's.
    const alts = exactAlternatives(matcher, variants)
    return alts.some((a) => candidates.includes(a))
  }
  for (const source of variants(matcher)) {
    let re: RegExp
    try {
      re = new RegExp(source)
    } catch {
      // A malformed regex matcher never matches (fail closed for that variant).
      continue
    }
    if (regexCandidates.some((c) => re.test(c))) return true
  }
  return false
}

/**
 * Match a matcher against a single string field (non-tool events, e.g.
 * SessionStart `source`). `undefined`/`*`/`''` matches all.
 */
export function matchesField(matcher: string | undefined, value: string): boolean {
  if (isMatchAll(matcher)) return true
  return matchAny(matcher!, [value])
}

/** A matcher value against several spellings of one thing (a model's id and canonical name). */
export function matchesAnyField(matcher: string | undefined, values: readonly string[]): boolean {
  if (isMatchAll(matcher)) return true
  return matchAny(matcher!, values)
}

/** The exact-match set of `FileChanged` and `StopFailure`: no hyphen, space or comma. */
const NARROW_EXACT_ONLY = /^[A-Za-z0-9_|]*$/

/**
 * `FileChanged` and `StopFailure` matchers: exact only for letters, digits, `_` and `|`, split on
 * `|` alone; any other character (`.env` included) makes the matcher a regex, as in CC.
 */
export function matchesNarrowField(matcher: string | undefined, value: string): boolean {
  if (isMatchAll(matcher)) return true
  const source = matcher!.trim()
  if (NARROW_EXACT_ONLY.test(source)) return source.split('|').some((alt) => alt === value)
  try {
    return new RegExp(source).test(value)
  } catch {
    return false
  }
}

/**
 * The literal filenames a `FileChanged` matcher asks to watch: its value split on `|`, each
 * segment a filename in the working directory (a regex would name a file literally, as in CC).
 */
export function fileChangedWatchNames(matcher: string | undefined): string[] {
  if (matcher === undefined || matcher.trim() === '') return []
  return matcher
    .split('|')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
}

/** Claude Code's tool names as it writes them, so a case-sensitive regex (`^Bash$`) matches. */
const CC_CASED_NAMES: ReadonlyMap<string, string> = new Map(
  [
    'Read',
    'Write',
    'Edit',
    'MultiEdit',
    'Bash',
    'Grep',
    'Glob',
    'LS',
    'NotebookRead',
    'NotebookEdit',
    'Skill',
    'WebFetch',
    'WebSearch',
    'AskUserQuestion',
    'Task',
    'KillShell',
  ].map((name) => [name.toLowerCase(), name]),
)

/** The tools Claude Code itself names, which a regex sees by that name alone. */
const CC_NATIVE: ReadonlySet<string> = new Set([TOOL.Agent, TOOL.SendMessage, TOOL.TaskStop])

/** Reverse index: tool name → every lowercased CC name that maps to it. */
const ENGINE_TO_CC: Readonly<Record<string, string[]>> = (() => {
  const out: Record<string, string[]> = {}
  for (const [cc, engine] of Object.entries(CC_LEGACY_TOOL_NAMES)) {
    ;(out[engine] ??= []).push(cc)
  }
  return out
})()

/**
 * The full set of names a matcher may use to refer to a tool: its own name plus every Claude Code
 * alias that maps to it, as Claude Code writes it. E.g. `Research` → `['Research','WebFetch',
 * 'WebSearch']`. The cased names are what a regex matcher sees as Claude Code does (`RegExp.test`
 * on `Bash`).
 */
export function toolNameCandidates(
  toolName: string,
  /** The tool's own other names (an MCP tool's `mcp__<server>__<tool>`), kept as written. */
  aliases: readonly string[] = [],
): string[] {
  const set = new Set<string>([toolName])
  for (const cc of ENGINE_TO_CC[toolName] ?? []) set.add(CC_CASED_NAMES.get(cc) ?? cc)
  // The names the tool's calls carry as `tool_name` (`Search` is `Grep` or `Glob` …).
  for (const cc of claudeCodeNames(toolName)) set.add(cc)
  for (const alias of aliases) set.add(alias)
  return [...set]
}

/** Claude Code's names that stand for one kind of this tool's calls only. */
const PER_CALL_NAMES = new Set(['grep', 'glob', 'ls', 'webfetch', 'websearch', 'agent', 'task'])
const PER_CALL_MORE = new Set(['exitplanmode', 'multiedit'])
const NOTEBOOK_NAMES = new Set(['notebookedit', 'notebookread'])

/**
 * The names one CALL answers to: the tool's own, its Claude Code name for this call (`Glob` for a
 * file listing, `Grep` for a content search, `TaskStop` for a stop), and the legacy names its
 * input still fits (`MultiEdit` for several edits, `NotebookEdit` / `NotebookRead` for a
 * notebook). A matcher naming another kind of call of the same tool does not fire.
 */
export function callNameCandidates(
  engineToolName: string,
  input: Record<string, unknown>,
  aliases: readonly string[] = [],
): string[] {
  const own = claudeCodeToolName({ name: engineToolName, aliases }, input)
  const edits = Array.isArray(input.edits) ? input.edits : []
  const paths = [input.path, input.file_path, ...edits.map((e) => (e as { path?: unknown })?.path)]
  const notebook = paths.some((p) => typeof p === 'string' && p.endsWith('.ipynb'))
  const notebookName = engineToolName === TOOL.Read ? 'notebookread' : 'notebookedit'
  // Every other Claude Code name of this tool stands for a different kind of call.
  const otherCalls = new Set(claudeCodeNames(engineToolName))
  const legacy = (cc: string) =>
    (cc === 'multiedit' && edits.length > 1) ||
    (cc === 'task' && own === 'Agent') ||
    (cc === notebookName && notebook)
  return toolNameCandidates(engineToolName, aliases)
    .filter((name) => {
      const lower = name.toLowerCase()
      if (name === own) return true
      // The tool's own name is also Claude Code's (`Bash`, `Skill`): where this call carries another
      // one of Claude Code's (`Monitor` is a `Bash` wait), the first is not this call's name.
      if (name === engineToolName && CC_CASED_NAMES.has(lower)) return false
      if (otherCalls.has(name) && name !== engineToolName) return legacy(lower)
      if (lower === engineToolName.toLowerCase() || lower === own.toLowerCase()) return true
      if (aliases.includes(name)) return true
      if (PER_CALL_NAMES.has(lower) || PER_CALL_MORE.has(lower) || NOTEBOOK_NAMES.has(lower))
        return legacy(lower)
      return true
    })
    .concat(own)
}

/**
 * Match a tool-event matcher against an engine tool name and the tool's own aliases
 * (translating CC↔engine names as described in the module header). Given the call's input,
 * the matcher meets the names of that call (`callNameCandidates`).
 */
export function matchesToolName(
  matcher: string | undefined,
  engineToolName: string,
  aliases?: readonly string[],
  input?: unknown,
): boolean {
  if (isMatchAll(matcher)) return true
  const candidates =
    input && typeof input === 'object' && !Array.isArray(input)
      ? callNameCandidates(engineToolName, input as Record<string, unknown>, aliases)
      : toolNameCandidates(engineToolName, aliases)
  // A tool Claude Code itself names (`Agent`) is seen by that name alone, not through its former
  // one (`Task`).
  const seen = CC_NATIVE.has(engineToolName) ? [engineToolName, ...(aliases ?? [])] : candidates
  return matchAny(matcher!, candidates, seen)
}
