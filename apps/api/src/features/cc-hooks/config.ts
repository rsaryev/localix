/**
 * Claude Code hook config loading + merging.
 *
 * Reads enabled plugins' `hooks/hooks.json` blocks and fuses them into one
 * normalized {@link CcHookRegistry}. Local Claude settings are deliberately not
 * consulted: installing and enabling a plugin is the consent boundary for running
 * its hooks.
 *
 * Only `type:"command"` handlers on supported events survive; any other handler
 * type is dropped (the caller may log it). Placeholders in an http url are substituted
 * here; in a shell command they are left for the shell to expand from the child
 * environment (see `bindShellCommand`), so no value is ever parsed as shell source.
 *
 * Pure-ish module — Node fs + the shared contracts only, no chat/UI imports.
 */
import { mkdirSync } from 'node:fs'

import {
  bindUserConfigInShell,
  collectUserConfigShellTokens,
  substituteUserConfigInText,
} from '../plugins/mcp-substitute'

import {
  CC_AGENT_HOOK_DEFAULT_TIMEOUT_SEC,
  CC_HOOK_DEFAULT_TIMEOUT_SEC,
  CC_HOOK_MAX_TIMEOUT_SEC,
  CC_PROMPT_HOOK_DEFAULT_TIMEOUT_SEC,
  isAgentHookEvent,
  isCcHookEvent,
  isHttpHookEvent,
  isMcpToolHookEvent,
  isPromptHookEvent,
  type CcHookEvent,
  type CcHookGroup,
  type CcHookHandler,
  type CcHookRegistry,
  type CcHookSource,
} from './contracts'
import { ccPluginMcpToolToEngine, pluginServerRefToEngineMcpTool } from './mcp-names'

/** A plugin's declared hook config, handed in by the loader (raw JSON + roots). */
export interface PluginHookConfig {
  pluginName: string
  /** Plugin install dir → `${CLAUDE_PLUGIN_ROOT}` substitution + child env. */
  pluginRoot: string
  /**
   * Persistent plugin data dir → `${CLAUDE_PLUGIN_DATA}` substitution + child env: the loader's
   * `pluginDataDir` in the home it was given (our `~/.localix/plugin-data/<id>`, CC's
   * `~/.claude/plugins/data/<id>`).
   */
  dataDir: string
  /** Resolved plugin user-config values → `${user_config.KEY}` substitution. */
  config?: Record<string, string | number | boolean>
  /**
   * Config keys declared `secret: true` in the manifest. Hook commands are SHELL
   * strings, so these are NEVER substituted there — the token survives verbatim
   * (validation warns; the value reaches the hook via environment instead).
   */
  sensitiveKeys?: readonly string[]
  /** Parsed contents of the plugin's `hooks/hooks.json` (the `{ hooks: {...} }` shape). */
  raw: unknown
}

/** A skipped handler (unsupported type), surfaced so the caller can debug-log it. */
export interface SkippedHandler {
  source: CcHookSource
  event: string
  type: string
}

export interface BuildRegistryResult {
  registry: CcHookRegistry
  skipped: SkippedHandler[]
}

interface SubstOpts {
  projectDir: string
  pluginRoot?: string
  /** `${CLAUDE_PLUGIN_DATA}` value (plugin hooks only) — dir is created lazily. */
  pluginDataDir?: string
  /** Plugin user-config values for `${user_config.KEY}` (plugin hooks only). */
  config?: Record<string, string | number | boolean>
  /** True for `secret: true` config keys — never substituted into shell strings. */
  isSensitive?: (key: string) => boolean
}

/** Data dirs already ensured this process — mkdir once per dir, best-effort. */
const ensuredDataDirs = new Set<string>()

function ensureDataDir(dir: string): void {
  if (ensuredDataDirs.has(dir)) return
  ensuredDataDirs.add(dir)
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // best-effort — a hook referencing a dir we can't create still runs
  }
}

/**
 * Resolve CC path placeholders + `${user_config.KEY}` in a hook http url — TEXT, not run by a
 * shell, so values are pasted. Sensitive config keys are NEVER substituted — the literal token
 * survives (static validation warns). A command goes through {@link bindShellCommand} instead.
 */
function substituteUrl(url: string, opts: SubstOpts): string {
  let out = url.split('${CLAUDE_PROJECT_DIR}').join(opts.projectDir)
  if (opts.pluginRoot) out = out.split('${CLAUDE_PLUGIN_ROOT}').join(opts.pluginRoot)
  if (opts.pluginDataDir) out = out.split('${CLAUDE_PLUGIN_DATA}').join(opts.pluginDataDir)
  if (opts.config && out.includes('${user_config.')) {
    out = substituteUserConfigInText(out, opts.config, opts.isSensitive ?? (() => false)).value
  }
  return out
}

/**
 * Prepare a hook COMMAND, which `sh -c` parses as source: nothing user-controlled is pasted in.
 *
 * THE DEFECT THIS STOPS. `${CLAUDE_PROJECT_DIR}` used to be replaced by the project path before
 * the shell saw the command, so a project cloned into a folder named `x$(touch PWNED)` ran
 * `touch PWNED` on every hook — and a non-secret `${user_config.KEY}` value did the same. Both are
 * now left for the SHELL to expand from the child environment (the executor sets
 * `CLAUDE_PROJECT_DIR`/`CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA`; config values ride in
 * `shellEnv`), and a shell never re-parses an expansion. This is Claude Code's own contract:
 * `${CLAUDE_PROJECT_DIR}` is ordinary shell parameter syntax, and `"$CLAUDE_PROJECT_DIR"` in a hook
 * keeps working because it already read the same variable.
 */
function bindShellCommand(
  command: string,
  opts: SubstOpts,
): { command: string; shellEnv?: Record<string, string> } {
  // Referenced → make sure the dir exists before the hook's shell resolves it.
  if (opts.pluginDataDir && command.includes('CLAUDE_PLUGIN_DATA')) {
    ensureDataDir(opts.pluginDataDir)
  }
  if (!opts.config || !command.includes('${user_config.')) return { command }
  const bound = bindUserConfigInShell(command, opts.config, opts.isSensitive ?? (() => false))
  return Object.keys(bound.env).length > 0
    ? { command: bound.value, shellEnv: bound.env }
    : { command: bound.value }
}

/**
 * Collect the `${user_config.KEY}` keys referenced by a raw hooks block's
 * substitutable strings (`command` + http `url`) — the positions where sensitive
 * keys are NEVER substituted. Static plugin validation intersects this with the
 * manifest's `secret: true` keys to warn authors (mirror of the MCP check).
 */
export function collectHookUserConfigTokens(raw: unknown): Set<string> {
  const keys = new Set<string>()
  if (!isRecord(raw)) return keys
  const hooksMap = isRecord(raw.hooks) ? raw.hooks : raw
  if (!isRecord(hooksMap)) return keys
  for (const groupsRaw of Object.values(hooksMap)) {
    if (!Array.isArray(groupsRaw)) continue
    for (const groupRaw of groupsRaw) {
      if (!isRecord(groupRaw)) continue
      const handlersRaw = Array.isArray(groupRaw.hooks) ? groupRaw.hooks : []
      for (const hRaw of handlersRaw) {
        if (!isRecord(hRaw)) continue
        for (const field of [hRaw.command, hRaw.url]) {
          if (typeof field !== 'string') continue
          for (const key of collectUserConfigShellTokens(field)) keys.add(key)
        }
      }
    }
  }
  return keys
}

function clampTimeoutMs(rawSeconds: unknown, defaultSec = CC_HOOK_DEFAULT_TIMEOUT_SEC): number {
  const sec =
    typeof rawSeconds === 'number' && Number.isFinite(rawSeconds) && rawSeconds > 0
      ? Math.min(rawSeconds, CC_HOOK_MAX_TIMEOUT_SEC)
      : defaultSec
  return Math.round(sec * 1000)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Parse one raw `hooks` block into a partial registry. `raw` is either a full
 * settings object (`{ hooks: {...} }`) or the inner hooks map — both are accepted.
 * Unsupported handler types + unknown events are collected into `skipped`.
 */
export function parseHooksBlock(
  raw: unknown,
  source: CcHookSource,
  opts: SubstOpts & { pluginName?: string },
  skipped: SkippedHandler[] = [],
): CcHookRegistry {
  const registry: CcHookRegistry = {}
  if (!isRecord(raw)) return registry
  const hooksMap = isRecord(raw.hooks) ? raw.hooks : raw
  if (!isRecord(hooksMap)) return registry

  for (const [eventName, groupsRaw] of Object.entries(hooksMap)) {
    if (!isCcHookEvent(eventName)) continue // parsed leniently, never fired
    if (!Array.isArray(groupsRaw)) continue
    const event: CcHookEvent = eventName
    const groups: CcHookGroup[] = []
    for (const groupRaw of groupsRaw) {
      if (!isRecord(groupRaw)) continue
      const matcher = typeof groupRaw.matcher === 'string' ? groupRaw.matcher : undefined
      const handlersRaw = Array.isArray(groupRaw.hooks) ? groupRaw.hooks : []
      const handlers: CcHookHandler[] = []
      for (const hRaw of handlersRaw) {
        if (!isRecord(hRaw)) continue
        const handler = parseHandler(hRaw, event, source, opts, skipped)
        if (handler) handlers.push(handler)
      }
      if (handlers.length > 0) groups.push({ matcher, handlers })
    }
    if (groups.length > 0) registry[event] = groups
  }
  return registry
}

/** Common `if` / `once` fields shared by every handler type. */
function commonHandlerFields(hRaw: Record<string, unknown>): Partial<CcHookHandler> {
  return {
    ...(typeof hRaw.if === 'string' && hRaw.if.trim() ? { if: hRaw.if.trim() } : {}),
    ...(hRaw.once === true ? { once: true } : {}),
  }
}

/**
 * Parse one raw handler entry into a {@link CcHookHandler}, or `undefined` when it
 * is unusable (missing fields) or an unsupported event×type combination (recorded
 * in `skipped`). Supports all five CC handler types, each on the events the CC
 * matrix (hooks.md §7) allows — see the type helpers in `contracts.ts`.
 */
function parseHandler(
  hRaw: Record<string, unknown>,
  event: CcHookEvent,
  source: CcHookSource,
  opts: SubstOpts & { pluginName?: string },
  skipped: SkippedHandler[],
): CcHookHandler | undefined {
  const type = typeof hRaw.type === 'string' ? hRaw.type : 'command'
  const pluginName = opts.pluginName ? { pluginName: opts.pluginName } : {}

  if (type === 'prompt' || type === 'agent') {
    // Prompt + agent hooks only fire on the LLM-gate events; elsewhere they drop.
    const supported = type === 'prompt' ? isPromptHookEvent(event) : isAgentHookEvent(event)
    if (!supported) {
      skipped.push({ source, event, type })
      return undefined
    }
    if (typeof hRaw.prompt !== 'string' || !hRaw.prompt.trim()) return undefined
    const defaultTimeout =
      type === 'prompt' ? CC_PROMPT_HOOK_DEFAULT_TIMEOUT_SEC : CC_AGENT_HOOK_DEFAULT_TIMEOUT_SEC
    return {
      source,
      kind: type,
      ...pluginName,
      command: '', // unused for prompt / agent handlers
      prompt: hRaw.prompt,
      ...(typeof hRaw.model === 'string' && hRaw.model.trim()
        ? { promptModel: hRaw.model.trim() }
        : {}),
      ...(type === 'agent' &&
      typeof hRaw.maxTurns === 'number' &&
      Number.isFinite(hRaw.maxTurns) &&
      hRaw.maxTurns > 0
        ? { agentMaxTurns: Math.floor(hRaw.maxTurns) }
        : {}),
      timeoutMs: clampTimeoutMs(hRaw.timeout, defaultTimeout),
      ...commonHandlerFields(hRaw),
    }
  }

  if (type === 'http') {
    if (!isHttpHookEvent(event)) {
      skipped.push({ source, event, type })
      return undefined
    }
    if (typeof hRaw.url !== 'string' || !hRaw.url.trim()) return undefined
    const headers = isRecord(hRaw.headers)
      ? Object.fromEntries(
          Object.entries(hRaw.headers).filter(
            (e): e is [string, string] => typeof e[1] === 'string',
          ),
        )
      : undefined
    const allowedEnvVars = Array.isArray(hRaw.allowedEnvVars)
      ? hRaw.allowedEnvVars.filter((v): v is string => typeof v === 'string')
      : undefined
    return {
      source,
      kind: 'http',
      ...pluginName,
      command: '', // unused for http handlers
      httpUrl: substituteUrl(hRaw.url, opts),
      ...(headers && Object.keys(headers).length > 0 ? { httpHeaders: headers } : {}),
      ...(allowedEnvVars && allowedEnvVars.length > 0
        ? { httpAllowedEnvVars: allowedEnvVars }
        : {}),
      timeoutMs: clampTimeoutMs(hRaw.timeout),
      ...commonHandlerFields(hRaw),
    }
  }

  if (type === 'mcp_tool') {
    if (!isMcpToolHookEvent(event)) {
      skipped.push({ source, event, type })
      return undefined
    }
    // CC config: `{ server, tool }` OR a single full `tool` name. Combine when both
    // are present; otherwise the `tool` field already carries the full name.
    // Plugin-scoped forms resolve to the ENGINE tool name here (the runtime caller
    // only aliases the generic `mcp__server__tool` form): `server:
    // "plugin:<plugin>:<server>"` and a full `mcp__plugin_<plugin>_<server>__<tool>`
    // both map to our `mcp_<plugin>_<server>_<tool>` (see ./mcp-names.ts).
    const toolField = typeof hRaw.tool === 'string' ? hRaw.tool.trim() : ''
    const serverField = typeof hRaw.server === 'string' ? hRaw.server.trim() : ''
    if (!toolField) return undefined
    const mcpTool =
      pluginServerRefToEngineMcpTool(serverField, toolField) ??
      (serverField
        ? `mcp__${serverField}__${toolField}`
        : (ccPluginMcpToolToEngine(toolField) ?? toolField))
    return {
      source,
      kind: 'mcp_tool',
      ...pluginName,
      command: '', // unused for mcp_tool handlers
      mcpTool,
      timeoutMs: clampTimeoutMs(hRaw.timeout),
      ...commonHandlerFields(hRaw),
    }
  }

  if (type !== 'command') {
    skipped.push({ source, event, type }) // unknown type — recorded, never thrown
    return undefined
  }

  if (typeof hRaw.command !== 'string' || !hRaw.command.trim()) return undefined
  // asyncRewake implies async (CC: it is a superset of the background mode).
  const asyncRewake = hRaw.asyncRewake === true
  const isAsync = asyncRewake || hRaw.async === true
  return {
    source,
    ...(opts.pluginName ? { pluginName: opts.pluginName } : {}),
    ...(opts.pluginRoot ? { pluginRoot: opts.pluginRoot } : {}),
    ...(opts.pluginDataDir ? { pluginDataDir: opts.pluginDataDir } : {}),
    ...bindShellCommand(hRaw.command, opts),
    timeoutMs: clampTimeoutMs(hRaw.timeout),
    ...(typeof hRaw.if === 'string' && hRaw.if.trim() ? { if: hRaw.if.trim() } : {}),
    ...(isAsync ? { async: true } : {}),
    ...(asyncRewake ? { asyncRewake: true } : {}),
    ...(typeof hRaw.rewakeMessage === 'string' ? { rewakeMessage: hRaw.rewakeMessage } : {}),
    ...(typeof hRaw.rewakeSummary === 'string' ? { rewakeSummary: hRaw.rewakeSummary } : {}),
    ...(hRaw.once === true ? { once: true } : {}),
  }
}

/**
 * Parse a run-SCOPED hooks block from a skill's or a sub-agent's frontmatter (the
 * raw CC `hooks` map). Reuses {@link parseHooksBlock}, then — when the component
 * runs as a sub-agent (`asSubagent`, i.e. a `context: fork` skill or a delegated
 * agent) — auto-converts any `Stop` groups to `SubagentStop`, per CC (a subagent's
 * `Stop` hooks fire as `SubagentStop`). Path placeholders resolve against `projectDir`.
 */
export function parseScopedHooks(
  raw: unknown,
  source: Extract<CcHookSource, 'skill' | 'agent'>,
  opts: { projectDir: string; asSubagent?: boolean },
  skipped: SkippedHandler[] = [],
): CcHookRegistry {
  const registry = parseHooksBlock(raw, source, { projectDir: opts.projectDir }, skipped)
  if (opts.asSubagent && registry.Stop?.length) {
    // Move Stop → SubagentStop (append after any existing SubagentStop groups).
    ;(registry.SubagentStop ??= []).push(...registry.Stop)
    delete registry.Stop
  }
  return registry
}

/** Append all of `src`'s groups onto `dest` (in place) — the "all sources merge" rule. */
function mergeInto(dest: CcHookRegistry, src: CcHookRegistry): void {
  for (const [event, groups] of Object.entries(src) as [keyof CcHookRegistry, CcHookGroup[]][]) {
    if (!groups) continue
    ;(dest[event] ??= []).push(...groups)
  }
}

/** Public merge: append every group of `src` onto `dest` (in place). CC additive-merge rule. */
export function mergeCcHookRegistries(dest: CcHookRegistry, src: CcHookRegistry): void {
  mergeInto(dest, src)
}

/**
 * Build the fully-merged hook registry for a run from every enabled plugin's
 * hooks.json. All matching handlers from all enabled plugins run.
 */
export async function buildCcHookRegistry(opts: {
  projectDir: string
  pluginHooks?: readonly PluginHookConfig[]
}): Promise<BuildRegistryResult> {
  const skipped: SkippedHandler[] = []
  const registry: CcHookRegistry = {}

  for (const plugin of opts.pluginHooks ?? []) {
    const sensitive = new Set(plugin.sensitiveKeys ?? [])
    mergeInto(
      registry,
      parseHooksBlock(
        plugin.raw,
        'plugin',
        {
          projectDir: opts.projectDir,
          pluginName: plugin.pluginName,
          pluginRoot: plugin.pluginRoot,
          pluginDataDir: plugin.dataDir,
          ...(plugin.config ? { config: plugin.config } : {}),
          isSensitive: (key) => sensitive.has(key),
        },
        skipped,
      ),
    )
  }

  return { registry, skipped }
}
