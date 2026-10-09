/**
 * Claude Code `permissions` rule model, parser, and matcher.
 *
 * Parses the `allow` / `deny` / `ask` string arrays from the CC settings chain
 * (see `config.ts`) into structured, source-tagged rules and matches a tool call
 * against them per CC's `Tool` / `Tool(specifier)` grammar. Evaluation tiers:
 * **deny → ask → allow, first match within a tier wins**; an unmatched call gets
 * NO opinion (`undefined`) so the Localix engine's own decision stands.
 *
 * Supported grammar (a documented SUBSET of full CC — see docs/features/permissions.md):
 *   - Bare tool name (`Bash`, `Edit`, `mcp__server`) via the CC↔engine name map.
 *   - `Bash(prefix:*)` / `Bash(prefix *)` word-boundary prefix, `Bash(ls*)` raw
 *     prefix, `Bash(git * --x)` glob, `Bash(exact cmd)` exact; compound commands
 *     split on `&& || ; | |& &` + newlines (deny/ask = ANY subcommand matches;
 *     allow = ALL subcommands must match — a conservative, never-looser subset).
 *   - `Read(path)` / `Edit(path)` / `Write(path)` gitignore-style anchors
 *     (`//abs`, `~/home`, `/project-root`, `./root`, bare = any depth) with full
 *     glob syntax (`**`, `*`, `?`, `{a,b}`, `[a-z]` — `path-glob.ts`). Edit/Write
 *     cover BOTH file-mutating engine tools (`write` + `apply_patch`).
 *   - `WebFetch(domain:example.com)` (`*.sub` any-depth, apex excluded) matched
 *     against any tool carrying a `url` input (best-effort — no native WebFetch).
 *   - `mcp__server` / `mcp__server__tool` / `mcp__server__*` — matches both the
 *     engine `mcp_server_tool` alias and the CC double-underscore form.
 *   - `Skill(name)` / `Skill(name *)` → the `skill` tool's `name`.
 *
 * Pure module — imports only the read-only CC tool-name map. No chat/UI imports.
 *
 * The hook `if` guard reuses the exported rule parser and Bash/value helpers
 * below. Permission evaluation keeps only its tier and path-quantifier policy
 * here.
 */
import { splitCompoundCommand } from '../agent-core/tools/bash/bash-command-shape'
import { CC_TOOL_NAME_MAP } from '../ext/cc-tool-names'
import { globToRegExpSource } from './path-glob'
import { specifierIsAll, specifierMatchesValue, matchBash } from './permission-value-match'
import { matchPaths } from './permission-path-match'
import { matchWebFetch, matchMcp } from './permission-network-match'

export { specifierIsAll, specifierMatchesValue, matchBashSpecifier } from './permission-value-match'

export type CcSettingsScope = 'user' | 'project' | 'local'

/** Format-only permission block used by explicit plugin hook guards and parsers. */
export interface CcPermissionBlock {
  scope: CcSettingsScope
  path: string
  allow: string[]
  deny: string[]
  ask: string[]
  defaultMode?: string
  additionalDirectories: string[]
}

export type CcTier = 'deny' | 'ask' | 'allow'

export interface CcRuleSource {
  scope: CcSettingsScope
  path: string
  /**
   * Optional compatibility origin used only for display wording.
   */
  origin?: 'permissions' | 'autoMode'
}

/** One parsed CC permission rule, tagged with its tier + source file. */
export interface CcRule {
  tier: CcTier
  raw: string
  tool: string
  specifier?: string
  source: CcRuleSource
}

/** The fact-shape a rule is matched against — independent of the Localix engine. */
export interface CcRuleCall {
  /** Engine tool name (`bash`, `apply_patch`, `write`, `read`, `mcp_x_y`, `delegate`, `skill`). */
  engineToolName: string
  input: Record<string, unknown>
  /** Resolved absolute target paths the call touches (read target / cwd / patch files). */
  paths: string[]
  /** Resolved absolute FILE targets a write/apply_patch would mutate (excludes cwd). */
  filePaths: string[]
  /** Resolved command string(s), newline-joined (bash). */
  command?: string
  root?: string
  home?: string
}

export interface CcRuleMatch {
  action: CcTier
  rule: CcRule
}

// ── Parsing ────────────────────────────────────────────────────────────────

/** Split `Tool(specifier)` → `{ tool, specifier }`; bare `Tool` → no specifier. */
export function parseRuleString(raw: string): { tool: string; specifier?: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const m = /^([^()]+)\((.*)\)$/s.exec(trimmed)
  if (!m) return { tool: trimmed }
  return { tool: m[1]!.trim(), specifier: m[2]! }
}

function toRules(items: string[], tier: CcTier, source: CcRuleSource): CcRule[] {
  const out: CcRule[] = []
  for (const raw of items) {
    const parsed = parseRuleString(raw)
    if (!parsed) continue
    out.push({
      tier,
      raw,
      tool: parsed.tool,
      ...(parsed.specifier !== undefined ? { specifier: parsed.specifier } : {}),
      source,
    })
  }
  return out
}

/**
 * Parse every settings layer's `permissions` block into flat, source-tagged
 * rules (in low→high precedence order). Rules across scopes MERGE (concat) per
 * CC's array-merge rule; tier precedence is applied at evaluation, not here.
 */
export function parseCcPermissionRules(blocks: CcPermissionBlock[]): CcRule[] {
  const out: CcRule[] = []
  for (const b of blocks) {
    const source: CcRuleSource = { scope: b.scope, path: b.path }
    out.push(...toRules(b.deny, 'deny', source))
    out.push(...toRules(b.ask, 'ask', source))
    out.push(...toRules(b.allow, 'allow', source))
  }
  return out
}

// ── Tool targeting ───────────────────────────────────────────────────────────

type RuleToolKind = 'bash' | 'read' | 'edit' | 'webfetch' | 'mcp' | 'agent' | 'skill' | 'other'

const EDIT_FAMILY_CC = new Set(['edit', 'write', 'multiedit', 'notebookedit'])
/** Engine tools that mutate files — the target set for Edit/Write path rules. */
// A Claude Code `Edit(...)`/`Deny: Edit(...)` glob must cover every engine tool that EDITS a file,
// or a rule the user believes covers "editing files" silently skips one of them.
const EDIT_FAMILY_ENGINE = new Set(['write', 'edit', 'apply_patch'])

function classifyRuleTool(tool: string): RuleToolKind {
  if (tool.startsWith('mcp__')) return 'mcp'
  const lower = tool.toLowerCase()
  if (lower === 'bash') return 'bash'
  if (lower === 'read') return 'read'
  if (EDIT_FAMILY_CC.has(lower)) return 'edit'
  if (lower === 'webfetch') return 'webfetch'
  if (lower === 'agent') return 'agent'
  if (lower === 'skill') return 'skill'
  return 'other'
}

// ── Glob helpers ──────────────────────────────────────────────────────────────

/**
 * PATH globs (Read/Edit rules, hook file guards, skill `paths:`) compile through the one
 * picomatch-backed compiler, so braces and classes work; re-exported so its importers keep
 * reaching it through this module.
 */
export { globToRegExpSource }

// ── Specifier matchers ─────────────────────────────────────────────────────────

/**
 * Re-exported: the splitter lives in agent-core beside the read-only classifier, because the
 * live permission engine needs the same decomposition and core must not import a compat
 * feature. A second copy is how the two answers drift apart.
 */
export { splitCompoundCommand as bashSubcommands }

// ── Single-rule match ──────────────────────────────────────────────────────────

function ruleMatchesCall(rule: CcRule, call: CcRuleCall): boolean {
  const kind = classifyRuleTool(rule.tool)
  const engine = call.engineToolName
  switch (kind) {
    case 'bash':
      return engine === 'bash' && matchBash(rule.specifier, call, rule.tier)
    case 'read':
      return engine === 'read' && matchPaths(rule.specifier, call.paths, call, rule.tier)
    case 'edit':
      return (
        EDIT_FAMILY_ENGINE.has(engine) &&
        matchPaths(rule.specifier, call.filePaths, call, rule.tier)
      )
    case 'webfetch':
      return matchWebFetch(rule.specifier, call)
    case 'mcp':
      return matchMcp(rule.tool, engine)
    case 'agent':
      return false
    case 'skill': {
      if (engine !== 'skill') return false
      if (specifierIsAll(rule.specifier)) return true
      const name = typeof call.input.name === 'string' ? call.input.name : ''
      return name !== '' && specifierMatchesValue(rule.specifier!, name)
    }
    case 'other': {
      // Bare CC/engine tool name (e.g. a deny on `search`). Map to engine + match.
      const mapped = CC_TOOL_NAME_MAP[rule.tool.toLowerCase()] ?? rule.tool.toLowerCase()
      if (mapped !== engine) return false
      if (specifierIsAll(rule.specifier)) return true
      // Best-effort: glob the specifier over the first string input value.
      const first = firstStringValue(call.input)
      return first !== undefined && specifierMatchesValue(rule.specifier!, first)
    }
  }
}

function firstStringValue(input: Record<string, unknown>): string | undefined {
  for (const v of Object.values(input)) if (typeof v === 'string') return v
  return undefined
}

// ── Evaluation ─────────────────────────────────────────────────────────────────

/**
 * Evaluate the parsed CC rules against a call, tier by tier (deny → ask →
 * allow). Returns the first matching rule in the highest-priority tier, or
 * `undefined` when nothing matches (no opinion — the Localix engine decides).
 */
export function evaluateCcRules(
  rules: readonly CcRule[],
  call: CcRuleCall,
): CcRuleMatch | undefined {
  for (const tier of ['deny', 'ask', 'allow'] as const) {
    for (const rule of rules) {
      if (rule.tier !== tier) continue
      if (ruleMatchesCall(rule, call)) return { action: tier, rule }
    }
  }
  return undefined
}

/** Human-readable one-liner for a matched rule, naming the tier + source file. */
export function describeCcRuleMatch(match: CcRuleMatch): string {
  const verb =
    match.action === 'deny' ? 'denies' : match.action === 'ask' ? 'requires approval for' : 'allows'
  const kind = match.rule.source.origin === 'autoMode' ? 'auto-mode' : 'settings'
  return `Claude Code ${kind} rule "${match.rule.raw}" (${match.rule.source.scope}) ${verb} this action.`
}
