import { makeSubstituter } from '../ext/manifest-substitute'
import { pluginDataDir } from './mcp'
import type { PluginManifest } from './contracts'
import type { PluginConfigValues } from './config'
import type { DiscoveredPlugin } from './discovery'
import { buildLoadedAgent, type LoadedPlugins } from './loader-contract'
import { pluginOutputStyles } from './output-styles'

/**
 * Build a per-plugin substituter closure for the prompt/skill path.
 * Thin wrapper over the shared `makeSubstituter` — supplies the secret predicate
 * so that keys declared `secret: true` in the manifest are NOT substituted into
 * agent prompts, prompt sections, or skill content.
 */
export function makePluginSubstituter(
  pluginDir: string,
  pluginName: string,
  config: PluginConfigValues,
  manifest: PluginManifest,
  projectDir: string,
  home: string,
): (text: string) => string {
  return makeSubstituter({
    pluginRoot: pluginDir,
    dataDir: pluginDataDir(pluginName, home),
    projectDir,
    config,
    isSecret: (key) => Boolean(manifest.config?.[key]?.secret),
  })
}

/** Every string in a JSON-shaped value (object keys included) passed through `subst`. */
function substituteStrings(value: unknown, subst: (text: string) => string): unknown {
  if (typeof value === 'string') return subst(value)
  if (Array.isArray(value)) return value.map((item) => substituteStrings(item, subst))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      out[subst(key)] = substituteStrings(item, subst)
    }
    return out
  }
  return value
}

/** Append already-discovered declarations in the loader's existing order. */
export function appendPluginRuntimeDeclarations({
  plugin,
  config,
  subst,
  result,
  summary,
  opts,
}: {
  plugin: DiscoveredPlugin
  config: PluginConfigValues
  subst: (text: string) => string
  result: LoadedPlugins
  summary: LoadedPlugins['loaded'][number]
  opts: {
    homeDir: string
    /** The session project directory → `${CLAUDE_PROJECT_DIR}`. */
    cwd?: string
    logger?: { warn: (message: string, meta?: unknown) => void }
  }
}): void {
  // ---- Declarative CC hooks (manifest `hooks` / hooks/hooks.json) -------
  // Raw JSON only — the cc-hooks runtime binds ${CLAUDE_PLUGIN_ROOT} /
  // ${CLAUDE_PLUGIN_DATA} / ${CLAUDE_PROJECT_DIR} + non-sensitive
  // ${user_config.KEY} (as env the shell expands, never pasted into a command)
  // and merges these with the settings-file hooks. Hook
  // commands are shell strings, so `secret: true` keys are NEVER substituted
  // there (the cc-hooks side needs the key list to enforce that). Each resolved
  // config (file paths, an array of them, or an inline manifest object) is
  // contributed independently; a broken file contributes nothing and its load
  // failure is the plugin's error (Claude Code's Errors tab), the rest still loads.
  for (const message of plugin.entrypoints.hookErrors ?? []) {
    summary.error = summary.error ? `${summary.error}; ${message}` : message
    opts.logger?.warn(`plugin "${plugin.manifest.name}": ${message}`)
  }
  const sensitiveKeys = Object.entries(plugin.manifest.config ?? {}).flatMap(([key, option]) =>
    option.secret ? [key] : [],
  )
  for (const raw of plugin.entrypoints.hookConfigs) {
    result.ccHooks.push({
      pluginName: plugin.manifest.name,
      pluginRoot: plugin.dir,
      dataDir: pluginDataDir(plugin.manifest.name, opts.homeDir),
      config,
      sensitiveKeys,
      raw,
    })
  }

  // ---- Declarative CC LSP servers (manifest `lspServers` / .lsp.json) ---
  // Path vars (${CLAUDE_PLUGIN_ROOT}/${CLAUDE_PLUGIN_DATA}/${CLAUDE_PROJECT_DIR}) and
  // `${user_config.KEY}` are substituted in every string of the config. Unlike skill and agent
  // content, a sensitive option substitutes its real value here, as in Claude Code: the config
  // goes to a language server process, never to the model or a shell. Each string is substituted
  // on its own (no JSON round-trip), so a value holding a quote stays one string. Registered with
  // the LSP feature (project-root scoped) by the chat runtime — enabled only.
  if (Object.keys(plugin.entrypoints.lspServers).length > 0) {
    const lspSubst = makeSubstituter({
      pluginRoot: plugin.dir,
      dataDir: pluginDataDir(plugin.manifest.name, opts.homeDir),
      projectDir: opts.cwd || '',
      config,
      isSecret: () => false,
    })
    result.lspServers.push({
      pluginName: plugin.manifest.name,
      env: {
        CLAUDE_PLUGIN_ROOT: plugin.dir,
        CLAUDE_PLUGIN_DATA: pluginDataDir(plugin.manifest.name, opts.homeDir),
        ...(opts.cwd ? { CLAUDE_PROJECT_DIR: opts.cwd } : {}),
      },
      servers: substituteStrings(plugin.entrypoints.lspServers, lspSubst) as Record<
        string,
        unknown
      >,
    })
  }

  // ---- Background monitors (manifest `monitors` / monitors/monitors.json) -
  // Typed + de-duplicated in discovery; collected here (enabled plugins only — the
  // enable state is the trust gate) with the roots the monitor host substitutes
  // into each command. Spawned by the monitor host, never per turn.
  for (const monitor of plugin.entrypoints.monitors) {
    result.monitors.push({
      pluginName: plugin.manifest.name,
      pluginRoot: plugin.dir,
      dataDir: pluginDataDir(plugin.manifest.name, opts.homeDir),
      monitor,
    })
  }

  // ---- Output styles and default settings (Claude Code) -----------------
  // A style's instructions are prompt text, so they take the plugin's path and config variables
  // like an agent's prompt does. `settings.agent` names one of the plugin's own agents; one that
  // names none is reported in the plugin's validation instead (`validate.ts`).
  const components = plugin.entrypoints.components
  result.outputStyles.push(...pluginOutputStyles(plugin, subst))
  const mainAgent = components?.settings.agent
  const agent = mainAgent
    ? plugin.agents.find(
        (entry) =>
          entry.name === mainAgent || `${plugin.manifest.name}:${entry.name}` === mainAgent,
      )
    : undefined
  if (agent) result.mainAgent = buildLoadedAgent(plugin.manifest.name, agent, subst)
}
