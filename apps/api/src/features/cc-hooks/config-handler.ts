/** Normalize one hook handler, including timeout policy and safe substitutions. */
import { mkdirSync } from 'node:fs'
import { bindUserConfigInShell, substituteUserConfigInText } from '../plugins/mcp-substitute'
import {
  CC_AGENT_HOOK_DEFAULT_TIMEOUT_SEC,
  CC_HOOK_DEFAULT_TIMEOUT_SEC,
  CC_HOOK_MAX_TIMEOUT_SEC,
  CC_PROMPT_HOOK_DEFAULT_TIMEOUT_SEC,
  isAgentHookEvent,
  isHttpHookEvent,
  isMcpToolHookEvent,
  isPromptHookEvent,
  type CcHookEvent,
  type CcHookHandler,
  type CcHookSource,
} from './contracts'
import { ccPluginMcpToolToEngine, pluginServerRefToEngineMcpTool } from './mcp-names'

/** A skipped handler (unsupported type), surfaced so the caller can debug-log it. */
export interface SkippedHandler {
  source: CcHookSource
  event: string
  type: string
}

export interface SubstOpts {
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

function clampTimeoutMs(rawSeconds: unknown, defaultSec = CC_HOOK_DEFAULT_TIMEOUT_SEC): number {
  const sec =
    typeof rawSeconds === 'number' && Number.isFinite(rawSeconds) && rawSeconds > 0
      ? Math.min(rawSeconds, CC_HOOK_MAX_TIMEOUT_SEC)
      : defaultSec
  return Math.round(sec * 1000)
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
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
export function parseHandler(
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
