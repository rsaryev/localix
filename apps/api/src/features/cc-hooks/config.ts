/**
 * Claude Code hook config loading + merging.
 *
 * Reads enabled plugins' `hooks/hooks.json` blocks and fuses them into one
 * normalized {@link CcHookRegistry}. Local Claude settings are deliberately not
 * consulted: installing and enabling a plugin is the consent boundary for running
 * its hooks.
 *
 * Handler types are accepted on their supported events; unsupported combinations
 * are dropped (the caller may log them). Placeholders in an http url are substituted
 * here; in a shell command they are left for the shell to expand from the child
 * environment (see `bindShellCommand`), so no value is ever parsed as shell source.
 *
 * Pure-ish module — Node fs + the shared contracts only, no chat/UI imports.
 */
import { collectUserConfigShellTokens } from '../ext/user-config-substitute'
import type {
  CcHookEvent,
  CcHookGroup,
  CcHookHandler,
  CcHookRegistry,
  CcHookSource,
} from './contracts'
import { isCcHookEvent } from './contracts'
import { parseHandler } from './config-handler'
import type { SubstOpts, SkippedHandler } from './config-handler'
import { isRecord } from '../../lib/record'

export type { SkippedHandler } from './config-handler'

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

/** The plugin a skill's or an agent's frontmatter `hooks` block ships in. */
export interface ScopedHookPlugin {
  name: string
  /** Plugin install dir → `${CLAUDE_PLUGIN_ROOT}`. */
  root: string
  /** Persistent plugin data dir → `${CLAUDE_PLUGIN_DATA}`. */
  dataDir: string
}

export interface BuildRegistryResult {
  registry: CcHookRegistry
  skipped: SkippedHandler[]
}

/**
 * Collect the `${user_config.KEY}` keys referenced by a raw hooks block's
 * substitutable strings (shell-form `command` + http `url`) — the positions where sensitive
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
        // An exec-form command (`args`) is never parsed by a shell: every value substitutes there.
        if (!isRecord(hRaw) || Array.isArray(hRaw.args)) continue
        for (const field of [hRaw.command, hRaw.url]) {
          if (typeof field !== 'string') continue
          for (const key of collectUserConfigShellTokens(field)) keys.add(key)
        }
      }
    }
  }
  return keys
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

/**
 * Parse a run-SCOPED hooks block from a skill's or a sub-agent's frontmatter (the
 * raw CC `hooks` map). Reuses {@link parseHooksBlock}, then — when the component
 * runs as a sub-agent (`asSubagent`, i.e. a `context: fork` skill or a delegated
 * agent) — auto-converts any `Stop` groups to `SubagentStop`, per CC (a subagent's
 * `Stop` hooks fire as `SubagentStop`). Path placeholders resolve against `projectDir`; a
 * component shipped by a plugin (`plugin`) also gets that plugin's `${CLAUDE_PLUGIN_ROOT}` and
 * `${CLAUDE_PLUGIN_DATA}`, in its http urls and its commands' environment, as Claude Code gives
 * every plugin component.
 */
export function parseScopedHooks(
  raw: unknown,
  source: Extract<CcHookSource, 'skill' | 'agent'>,
  opts: { projectDir: string; asSubagent?: boolean; plugin?: ScopedHookPlugin },
  skipped: SkippedHandler[] = [],
): CcHookRegistry {
  const { plugin } = opts
  const registry = parseHooksBlock(
    raw,
    source,
    {
      projectDir: opts.projectDir,
      ...(plugin
        ? { pluginName: plugin.name, pluginRoot: plugin.root, pluginDataDir: plugin.dataDir }
        : {}),
    },
    skipped,
  )
  if (opts.asSubagent && registry.Stop?.length) {
    // Move Stop → SubagentStop (append after any existing SubagentStop groups).
    ;(registry.SubagentStop ??= []).push(...registry.Stop)
    delete registry.Stop
  }
  return registry
}

/** Append all of `src`'s groups onto `dest` (in place) — the "all sources merge" rule. */
export function mergeCcHookRegistries(dest: CcHookRegistry, src: CcHookRegistry): void {
  for (const [event, groups] of Object.entries(src) as [keyof CcHookRegistry, CcHookGroup[]][]) {
    if (!groups) continue
    ;(dest[event] ??= []).push(...groups)
  }
}

/**
 * Build the fully-merged hook registry for a run from every enabled plugin's
 * hooks.json. All matching handlers from all enabled plugins run.
 */
export async function buildCcHookRegistry(opts: {
  projectDir: string
  pluginHooks?: readonly PluginHookConfig[]
  /** The `hooks` of Claude Code's settings files (`cc-settings/settings-hooks.ts`), lowest first. */
  settingsHooks?: ReadonlyArray<{ source: 'user' | 'project' | 'local'; raw: unknown }>
}): Promise<BuildRegistryResult> {
  const skipped: SkippedHandler[] = []
  const registry: CcHookRegistry = {}

  for (const block of opts.settingsHooks ?? [])
    mergeCcHookRegistries(
      registry,
      parseHooksBlock(block.raw, block.source, { projectDir: opts.projectDir }, skipped),
    )

  for (const plugin of opts.pluginHooks ?? []) {
    const sensitive = new Set(plugin.sensitiveKeys ?? [])
    mergeCcHookRegistries(
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
