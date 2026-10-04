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

/**
 * Compile a COMMAND/VALUE specifier (Bash, Skill, Agent, MCP) to a regex SOURCE: `**\/` →
 * optional intermediate dirs, `**` → any, `*` → one segment, `?` → one char — and
 * everything else escaped. This stays wildcard-only on purpose: a command is not a path,
 * and `Bash(echo {a,b} *)` or `Bash(python -c print(1) *)` must match the braces and
 * parentheses the person typed, not expand them as glob syntax.
 */
function wildcardToRegExpSource(glob: string): string {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') {
          i++
          out += '(?:.*/)?' // `**/` → optional intermediate dirs
        } else {
          out += '.*'
        }
      } else {
        out += '[^/]*'
      }
    } else if (c === '?') {
      out += '[^/]'
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return out
}

function fullGlobMatch(pattern: string, value: string): boolean {
  try {
    return new RegExp(`^${wildcardToRegExpSource(pattern)}$`).test(value)
  } catch {
    return false
  }
}

/** Anchored path match: the whole absolute path against an anchored path glob. */
function fullPathMatch(pattern: string, absPath: string): boolean {
  try {
    return new RegExp(`^${globToRegExpSource(pattern)}$`).test(absPath)
  } catch {
    return false
  }
}

/** Match a bare (un-anchored) pattern at any path depth (basename or subpath suffix). */
function anyDepthMatch(pattern: string, absPath: string): boolean {
  try {
    return new RegExp(`(^|/)${globToRegExpSource(pattern)}$`).test(absPath)
  } catch {
    return false
  }
}

// ── Specifier matchers ─────────────────────────────────────────────────────────

/** True when a specifier means "any invocation" (absent, empty, or `*`). */
export function specifierIsAll(specifier: string | undefined): boolean {
  if (specifier === undefined) return true
  const t = specifier.trim()
  return t === '' || t === '*'
}

/** Generic value match (skill/agent/other): `prefix *` / `prefix:*` prefix, `*` glob, else exact. */
export function specifierMatchesValue(specifier: string, value: string): boolean {
  const spec = specifier.trim()
  const v = value.trim()
  if (spec.endsWith(':*')) return v.startsWith(spec.slice(0, -2).trim())
  if (spec.endsWith(' *')) return v.startsWith(spec.slice(0, -2).trim())
  if (spec.includes('*')) return fullGlobMatch(spec, v)
  return v === spec
}

/** Bash specifier match with CC word-boundary semantics against ONE subcommand. */
export function matchBashSpecifier(specifier: string, cmd: string): boolean {
  const spec = specifier.trim()
  const v = cmd.trim()
  // `prefix:*` and `prefix *` both mean a word-boundary prefix.
  if (spec.endsWith(':*') || spec.endsWith(' *')) {
    const prefix = spec.slice(0, -2).trim()
    return v === prefix || v.startsWith(prefix + ' ')
  }
  // `ls*` — raw prefix, no boundary (matches `lsof` too).
  if (spec.endsWith('*') && !spec.slice(0, -1).includes('*')) {
    return v.startsWith(spec.slice(0, -1))
  }
  if (spec.includes('*')) return fullGlobMatch(spec, v)
  return v === spec
}

/**
 * Re-exported: the splitter lives in agent-core beside the read-only classifier, because the
 * live permission engine needs the same decomposition and core must not import a compat
 * feature. A second copy is how the two answers drift apart.
 */
export { splitCompoundCommand as bashSubcommands }

function matchBash(specifier: string | undefined, call: CcRuleCall, tier: CcTier): boolean {
  if (specifierIsAll(specifier)) return true
  if (call.command === undefined || call.command.trim() === '') return false
  const subs = splitCompoundCommand(call.command)
  if (subs === null) return false // substitution — can't confidently match
  const spec = specifier!
  return tier === 'allow'
    ? subs.every((s) => matchBashSpecifier(spec, s)) // allow: EVERY subcommand must match
    : subs.some((s) => matchBashSpecifier(spec, s)) // deny/ask: ANY subcommand matches
}

/** Resolve a path specifier's anchor into an absolute glob pattern, or `null` (bare). */
function anchorPattern(
  spec: string,
  root: string | undefined,
  home: string | undefined,
): string | null {
  if (spec.startsWith('//')) return '/' + spec.slice(2)
  if (spec.startsWith('~/')) return home ? joinPath(home, spec.slice(2)) : null
  if (spec.startsWith('./')) return root ? joinPath(root, spec.slice(2)) : null
  if (spec.startsWith('/')) return root ? joinPath(root, spec.slice(1)) : null
  return null // bare → any-depth match
}

/** Minimal path join that keeps glob chars intact (no fs normalization of `*`). */
function joinPath(a: string, b: string): string {
  return a.replace(/\/+$/, '') + '/' + b.replace(/^\/+/, '')
}

function matchOnePath(spec: string, absPath: string, root?: string, home?: string): boolean {
  const anchored = anchorPattern(spec, root, home)
  if (anchored !== null) return fullPathMatch(anchored, absPath)
  // Bare pattern → match at any depth (basename or subpath suffix).
  return anyDepthMatch(spec, absPath)
}

function matchPaths(
  specifier: string | undefined,
  targets: string[],
  call: CcRuleCall,
  tier: CcTier,
): boolean {
  if (specifierIsAll(specifier)) return true
  if (targets.length === 0) return false
  const spec = specifier!
  const test = (p: string) => matchOnePath(spec, p, call.root, call.home)
  return tier === 'allow' ? targets.every(test) : targets.some(test)
}

function matchDomain(pattern: string, host: string): boolean {
  const p = pattern.trim().toLowerCase()
  const h = host.trim().toLowerCase()
  if (p === '' || p === '*') return true
  if (p.startsWith('*.')) return h.endsWith('.' + p.slice(2)) // any subdomain depth, apex excluded
  // Non-leading `*` matches only within a label.
  try {
    const src = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\\?\*/g, '[^.]*')
    return new RegExp(`^${src}$`).test(h)
  } catch {
    return h === p
  }
}

function callHosts(input: Record<string, unknown>): string[] {
  const values = [
    ...(typeof input.url === 'string' ? [input.url] : []),
    ...(Array.isArray(input.urls)
      ? input.urls.filter((url): url is string => typeof url === 'string')
      : []),
  ]
  const hosts: string[] = []
  for (const value of values) {
    try {
      hosts.push(new URL(value).hostname)
    } catch {
      // Invalid URLs are rejected by research itself; they cannot match a domain rule.
    }
  }
  for (const domain of Array.isArray(input.include_domains) ? input.include_domains : []) {
    if (typeof domain !== 'string' || !domain.trim()) continue
    try {
      hosts.push(new URL(domain.includes('://') ? domain : `https://${domain}`).hostname)
    } catch {
      // Invalid domain filters are rejected by the tool schema.
    }
  }
  return hosts
}

function matchWebFetch(specifier: string | undefined, call: CcRuleCall): boolean {
  if (specifierIsAll(specifier)) return true
  // Keep this authority check tool-agnostic: built-in research, plugins, and
  // MCP tools can all load URLs and must all obey an imported WebFetch rule.
  const hosts = callHosts(call.input)
  if (hosts.length === 0) return false
  const spec = specifier!.trim()
  const domain = spec.startsWith('domain:') ? spec.slice('domain:'.length) : spec
  return hosts.some((host) => matchDomain(domain, host))
}

/** Normalize an MCP rule prefix to the engine's `mcp_server_tool` form. */
function normalizeMcpPrefix(s: string): string {
  return s.replace(/__+/g, '_').replace(/[^a-zA-Z0-9_]/g, '_')
}

function matchMcp(ruleTool: string, engineName: string): boolean {
  if (!engineName.startsWith('mcp_')) return false
  if (ruleTool === 'mcp__*') return true
  const starIdx = ruleTool.indexOf('*')
  if (starIdx >= 0) {
    const prefix = normalizeMcpPrefix(ruleTool.slice(0, starIdx))
    return engineName.startsWith(prefix)
  }
  const parts = ruleTool.split('__').filter((p) => p.length > 0) // ['mcp','server'] | ['mcp','server','tool']
  const normalized = normalizeMcpPrefix(ruleTool)
  if (parts.length <= 2) {
    // server-only → every tool of that server
    return engineName === normalized || engineName.startsWith(normalized + '_')
  }
  return engineName === normalized
}

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
