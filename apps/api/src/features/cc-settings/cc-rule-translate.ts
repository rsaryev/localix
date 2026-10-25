/**
 * A Claude Code permission rule (`Tool` / `Tool(specifier)`, permissions.md) as the Localix
 * permission rows that pre-approve the same calls — a skill's `allowed-tools` is written this way.
 *
 * - `Bash(git push:*)` / `Bash(npm run *)`: the command patterns (`native-command-patterns.ts`).
 * - `Read(path)` / `Edit(path)`: gitignore-style path patterns anchored as permissions.md's "How
 *   path patterns match" says — `//p` the filesystem root, `~/p` home, `/p` the project, `p` and
 *   `./p` the working directory; a bare file name at any depth. Made absolute, since a call's
 *   facts are. `Edit` covers `edit` and `write` ("all built-in tools that edit files"), `Read`
 *   covers `read` and `search`. A `Write`, `NotebookEdit`, `Glob` or `MultiEdit` path rule
 *   "never matches", so it grants nothing.
 * - `WebFetch(domain:host)`: `research`'s `domain:<host>` resource (`research-resources.ts`). A
 *   `*` anywhere but a leading `*.` would cross dots in Localix's glob, so such a rule is left out.
 * - `Agent(type)` / `Skill(name)`: the agent and skill resources those tools declare.
 * - `mcp__server` / `mcp__server__*` / `mcp__server__tool`: the engine's MCP names.
 * - A `Tool(param:value)` rule applies to deny and ask only, so it grants nothing.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { PermissionRule } from '../agent-core/permission-engine'
import { normalizeCcToolName } from '../ext/cc-tool-names'
import { nativeCommandPatterns } from './native-command-patterns'
import { parseRuleString, specifierIsAll } from './permission-rules'

const PATH_TOOLS: Readonly<Record<string, readonly string[]>> = {
  read: ['read', 'search'],
  edit: ['edit', 'write'],
}
/** Tools whose path rules Claude Code accepts but never matches. */
const UNMATCHED_PATH_TOOLS = new Set(['write', 'notebookedit', 'glob', 'multiedit', 'grep'])

/** `a{b,c}d` → `abd`, `acd`; nested braces expand from the inside out. */
export function expandBraces(pattern: string): string[] {
  const match = /\{([^{}]*)\}/.exec(pattern)
  if (!match) return [pattern]
  const [whole, body] = match
  const head = pattern.slice(0, match.index)
  const tail = pattern.slice(match.index + whole.length)
  return body!.split(',').flatMap((choice) => expandBraces(`${head}${choice}${tail}`))
}

/**
 * The absolute patterns one Claude Code path specifier stands for, in Localix's glob (`*` any
 * run of characters, `/` included): `src/**` also names `src` itself, a bare name any depth.
 */
export function absolutePathPatterns(specifier: string, cwd: string, projectDir = cwd): string[] {
  const spec = specifier.trim()
  let base: string
  let rel: string
  if (spec.startsWith('//')) [base, rel] = ['/', spec.slice(2)]
  else if (spec === '~' || spec.startsWith('~/')) [base, rel] = [homedir(), spec.slice(2)]
  else if (spec.startsWith('/')) [base, rel] = [projectDir, spec.slice(1)]
  else [base, rel] = [cwd, spec.replace(/^\.\//, '')]
  const anyDepth =
    !spec.startsWith('/') && !spec.startsWith('~') && !rel.replace(/\/$/, '').includes('/')
  const out = new Set<string>()
  for (const choice of expandBraces(rel)) {
    const bare = choice.replace(/\/$/, '')
    const at = (path: string) => (path ? join(base, path) : base)
    const rooted = anyDepth ? [at(bare), `${at('')}/*/${bare}`.replace(/\/{2,}/g, '/')] : [at(bare)]
    for (const pattern of rooted) {
      out.add(pattern)
      // `dir/**` names the directory's files and the directory itself (`search` in it);
      // gitignore's `dir` and `dir/` name the directory and everything below it.
      if (pattern.endsWith('/**')) out.add(pattern.slice(0, -3))
      else if (!/[*?[]/.test(bare)) out.add(`${pattern}/*`)
    }
  }
  return [...out]
}

/** A `domain:` specifier in Localix's glob, or undefined when it cannot be said exactly. */
function domainPattern(specifier: string): string | undefined {
  const host = specifier.slice('domain:'.length).trim().toLowerCase().replace(/\.$/, '')
  if (!host) return undefined
  if (host === '*') return 'domain:*'
  const rest = host.startsWith('*.') ? host.slice(2) : host
  if (rest.includes('*')) return undefined
  return host.startsWith('*.') ? `domain:*.${rest}` : `domain:${rest}`
}

type Effect = 'allow' | 'deny'

const rowOf =
  (action: Effect, message?: string) =>
  (permission: string, pattern: string): PermissionRule => ({
    action,
    permission,
    pattern,
    ...(message ? { message } : {}),
  })

/** The Localix rows that grant what this Claude Code allow rule grants (none when it cannot). */
export function claudeCodeAllowRules(
  rule: string,
  cwd?: string,
  projectDir?: string,
): PermissionRule[] {
  return claudeCodeRules(rule, 'allow', cwd, projectDir)
}

/**
 * The Localix rows that deny what this Claude Code rule denies: a `disallowed-tools` entry of a
 * skill, command or agent. A bare name denies the tool; `Bash(rm *)` or `Read(.env)` denies only
 * that pattern, with the path and command patterns an allow rule uses. A specifier these rows
 * cannot say yields no row, never a wider one: the tool stays.
 */
export function claudeCodeDenyRules(
  rule: string,
  cwd?: string,
  projectDir?: string,
  message?: string,
): PermissionRule[] {
  return claudeCodeRules(rule, 'deny', cwd, projectDir, message)
}

function claudeCodeRules(
  rule: string,
  effect: Effect,
  cwd?: string,
  projectDir?: string,
  message?: string,
): PermissionRule[] {
  const allow = rowOf(effect, message)
  const parsed = parseRuleString(rule)
  if (!parsed) return []
  const ccTool = parsed.tool.trim()
  const lower = ccTool.toLowerCase()
  // `Agent` (formerly `Task`) is `delegate` here; a frontmatter `tools` list leaves it unmapped.
  const tool = lower === 'agent' || lower === 'task' ? 'delegate' : normalizeCcToolName(ccTool)
  // A bare deny takes away the one tool the name resolves to; a bare allow covers what `Read`
  // and `Edit` rules cover ("all built-in tools that read / edit files").
  const covered = effect === 'allow' ? (PATH_TOOLS[lower] ?? [tool]) : [tool]
  if (specifierIsAll(parsed.specifier)) return covered.map((name) => allow(name, '*'))
  const specifier = parsed.specifier!.trim()
  // permissions.md: a `Read(...)` deny also blocks Edit and Write on the path.
  const pathTools =
    effect === 'deny' && lower === 'read'
      ? [...PATH_TOOLS.read!, ...PATH_TOOLS.edit!]
      : (PATH_TOOLS[lower] ?? [tool])
  // permissions.md: Claude Code "skips any `mcp__` rule that has parentheses".
  if (ccTool.startsWith('mcp__')) return []
  if (tool === 'bash')
    return nativeCommandPatterns(specifier).map((pattern) => allow('bash', pattern))
  if (PATH_TOOLS[lower]) {
    if (!cwd) return pathTools.map((name) => allow(name, specifier))
    const patterns = absolutePathPatterns(specifier, cwd, projectDir)
    return pathTools.flatMap((name) => patterns.map((pattern) => allow(name, pattern)))
  }
  if (UNMATCHED_PATH_TOOLS.has(lower)) return []
  if (lower === 'webfetch') {
    const pattern = specifier.startsWith('domain:') ? domainPattern(specifier) : undefined
    return pattern ? [allow('research', pattern)] : []
  }
  // `Tool(param:value)`: deny and ask only ("allow rules continue to use each tool's own
  // specifier syntax"). `Skill(name:*)` is the prefix form, not a parameter.
  if (/^[A-Za-z_][\w-]*\s*:(?!\*$)/.test(specifier) && !specifier.endsWith(':*')) return []
  return nativeCommandPatterns(specifier).map((pattern) => allow(tool, pattern))
}
