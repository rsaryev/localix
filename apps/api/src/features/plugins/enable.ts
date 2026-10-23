import { trustClassOf, type TrustClass } from '../ext/trust'
import type { DiscoveredPlugin } from './discovery'

/**
 * What KIND of artifact a plugin is, so a rule can name it.
 *
 * This used to be `isEnabledByDefault` — a boolean the catalog combined with the rule store
 * through a `??`. The boolean answered "is it on", which is a decision, and a decision made
 * in two places by two owners is the thing this subsystem exists to stop having.
 *
 * The class is a fact instead: `untrusted` for anything that did not ship with the app
 * (a folder in `~/.localix/plugins` is not consent), `opt-in` for one of ours that imports
 * code without claiming `defaultEnabled`, `bundled` for the rest. What the class means when
 * no rule mentions the plugin is `trustFallback`, and what it means otherwise is an ordinary
 * row the user can read: `plugin:* untrusted ask`, `plugin:office * allow`.
 *
 * The plugin-specific part of the classification is `isCodeBearing` — "has native tools".
 */
export function pluginTrustClass(plugin: DiscoveredPlugin): TrustClass {
  return trustClassOf({
    isBundled: plugin.bundled,
    isCodeBearing: plugin.provides.hasNativeTools,
    // A bundled mini-app.json is ours and starts on, until mini apps leave this feature and a
    // first-party catalog install is what trusts one.
    defaultEnabled:
      plugin.manifest.defaultEnabled ??
      (plugin.bundled && plugin.layout === 'mini-app' ? true : undefined),
  })
}
