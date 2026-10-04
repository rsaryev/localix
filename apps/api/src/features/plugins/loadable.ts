import { apiVersionTooNew } from '../ext/manifest-validate'
import { PLUGIN_API_VERSION } from './contracts-base'
import type { DiscoveredPlugin } from './discovery'

/**
 * May this host RUN this plugin's code — and if not, why?
 *
 * Two conditions, one funnel. The load loop already skipped a fatal manifest error; the
 * `apiVersion` check was reported by `validatePlugin` into the Settings list and enforced NOWHERE, so
 * a plugin declaring an API this host does not implement was still imported, its `register()` run and
 * its tools/skills/agents/prompt sections contributed. The validator had already written the exact
 * sentence explaining why that could not work; it was decoration.
 *
 * Every path that imports plugin code must ask this — `loadEnabledPlugins`, `loadPluginChannel` and
 * the Settings tool inspection — because a gate honoured at one call site is not a gate.
 *
 * Returns the reason to SHOW the user (the plugin row already renders `error`), or null when the
 * plugin may load. A manifest that declares no `apiVersion` is assumed compatible, exactly as
 * `checkApiVersion` assumes: refusing legacy manifests would break every plugin written before the
 * field existed.
 */
export function pluginLoadBlockReason(plugin: DiscoveredPlugin): string | null {
  // A `manifestRecovered` plugin had its error coerced to a non-fatal warning — it loaded a usable
  // manifest and must NOT be blocked (graceful degradation).
  if (plugin.error && !plugin.manifestRecovered) return plugin.error
  return apiVersionTooNew('Plugin', PLUGIN_API_VERSION, plugin.manifest.apiVersion)
}
