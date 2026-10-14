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
 * NAME. Our engine tools carry lowercase names (`bash`, `search`, `edit`),
 * while CC matchers use CC names (`Bash`, `Grep`, `Edit`). We therefore match a
 * matcher against the FULL candidate set for a tool — the engine name plus every
 * CC name that maps to it (via the shared CC↔engine map) — so a `"Bash"` matcher
 * matches our `bash` tool and a raw `"bash"` matcher works too.
 *
 * MCP tools: a matcher written in a CC name form is aliased to the engine form via
 * `ccMcpMatcherVariants` — `mcp__server__tool` matches our `mcp_server_tool`, and the
 * CC PLUGIN form `mcp__plugin_<plugin>_<server>__<tool>` matches our
 * `mcp_<plugin>_<server>_<tool>` (see ./mcp-names.ts). Engine-form matchers match
 * directly, unchanged.
 *
 * Pure module — no chat/UI imports.
 */
import { CC_TOOL_NAME_MAP } from '../ext/cc-tool-names'
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
 * Split an exact-match matcher into its lowercased alternatives (on `|` or `,`),
 * expanding each CC MCP name form to its engine-form aliases (mcp-names.ts).
 */
function exactAlternatives(matcher: string): string[] {
  return matcher
    .split(/[|,]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
    .flatMap(ccMcpMatcherVariants)
}

/**
 * Match a matcher against a set of candidate names. Exact matchers compare
 * case-insensitively against each candidate; regex matchers `.test` each one —
 * a matcher whose source is a CC MCP name form is also tried with its engine-form
 * source rewrites (`mcp__…` → `mcp_…`), so CC-written regexes match live tools.
 */
function matchAny(matcher: string, candidates: readonly string[]): boolean {
  if (isMatchAll(matcher)) return true
  if (EXACT_ONLY.test(matcher)) {
    const alts = exactAlternatives(matcher)
    const lowered = candidates.map((c) => c.toLowerCase())
    return alts.some((a) => lowered.includes(a))
  }
  for (const source of ccMcpMatcherVariants(matcher)) {
    let re: RegExp
    try {
      re = new RegExp(source)
    } catch {
      // A malformed regex matcher never matches (fail closed for that variant).
      continue
    }
    if (candidates.some((c) => re.test(c))) return true
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

/** Reverse index: engine tool name → every lowercased CC name that maps to it. */
const ENGINE_TO_CC: Readonly<Record<string, string[]>> = (() => {
  const out: Record<string, string[]> = {}
  for (const [cc, engine] of Object.entries(CC_TOOL_NAME_MAP)) {
    ;(out[engine] ??= []).push(cc)
  }
  return out
})()

/**
 * The full set of names a matcher may use to refer to an engine tool: its own
 * (lowercased) engine name plus every CC alias that maps to it. E.g. engine
 * `research` → `['research','webfetch','websearch']`.
 */
export function toolNameCandidates(engineToolName: string): string[] {
  const lower = engineToolName.toLowerCase()
  const set = new Set<string>([lower])
  for (const cc of ENGINE_TO_CC[lower] ?? []) set.add(cc)
  // MCP + plugin tools have no CC alias — the engine name is the only candidate,
  // preserved in its original casing too so a case-sensitive regex still matches.
  if (engineToolName !== lower) set.add(engineToolName)
  return [...set]
}

/**
 * Match a tool-event matcher against an engine tool name (translating CC↔engine
 * names as described in the module header).
 */
export function matchesToolName(matcher: string | undefined, engineToolName: string): boolean {
  if (isMatchAll(matcher)) return true
  return matchAny(matcher!, toolNameCandidates(engineToolName))
}
