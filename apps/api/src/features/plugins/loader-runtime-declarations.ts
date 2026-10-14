import { errorMessage } from '../../lib/errors'
import { makeSubstituter } from '../ext/manifest-substitute'
import { pluginDataDir } from './mcp'
import type { PluginManifest } from './contracts'
import type { PluginConfigValues } from './config'
import type { DiscoveredPlugin } from './discovery'
import type { LoadedPlugins } from './loader-contract'

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
  opts: { homeDir: string; logger?: { warn: (message: string, meta?: unknown) => void } }
}): void {
  // ---- Declarative CC hooks (manifest `hooks` / hooks/hooks.json) -------
  // Raw JSON only — the cc-hooks runtime binds ${CLAUDE_PLUGIN_ROOT} /
  // ${CLAUDE_PLUGIN_DATA} / ${CLAUDE_PROJECT_DIR} + non-sensitive
  // ${user_config.KEY} (as env the shell expands, never pasted into a command)
  // and merges these with the settings-file hooks. Hook
  // commands are shell strings, so `secret: true` keys are NEVER substituted
  // there (the cc-hooks side needs the key list to enforce that). Each resolved
  // config (file paths, an array of them, or an inline manifest object) is
  // contributed independently; a broken source just contributes nothing.
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
  // Path vars (${CLAUDE_PLUGIN_ROOT}/${CLAUDE_PROJECT_DIR}/config) are substituted
  // via the shared subst closure by round-tripping the raw JSON. Registered with
  // the LSP feature (project-root scoped) by the chat runtime — enabled only.
  if (Object.keys(plugin.entrypoints.lspServers).length > 0) {
    try {
      const substituted = JSON.parse(
        subst(JSON.stringify(plugin.entrypoints.lspServers)),
      ) as Record<string, unknown>
      result.lspServers.push({ pluginName: plugin.manifest.name, servers: substituted })
    } catch (err) {
      // NOT a fallback to the raw servers: those still contain `${CLAUDE_PLUGIN_ROOT}` verbatim,
      // so the plugin registered as valid and then failed to spawn with a literal `${…}` in the
      // binary's path — a failure that surfaces later, elsewhere, and blames the wrong thing.
      // Contribute nothing and say why.
      const message = errorMessage(err)
      summary.error = summary.error ? `${summary.error}; ${message}` : message
      opts.logger?.warn(
        `plugin "${plugin.manifest.name}" contributed no LSP servers: their paths could not be resolved`,
        { error: message },
      )
    }
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
}
