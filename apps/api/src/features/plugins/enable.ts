import { trustClassOf, type TrustClass } from '../ext/trust'
import type { DiscoveredPlugin } from './discovery'

/**
 * What KIND of artifact a plugin is, so a rule can name it.
 *
 * A plugin built into Localix (`builtin-plugins.ts`) is `bundled`, so it runs unless its manifest
 * says `defaultEnabled: false` or a rule turns it off. Every other one was installed by the person
 * (a folder in `~/.localix/plugins` is not consent) or by Claude Code, so each is `untrusted` until
 * a rule says otherwise. What the class means when no rule mentions the plugin is `trustFallback`, and
 * what it means otherwise is an ordinary row the user can read: `plugin:* untrusted ask`,
 * `plugin:office * allow`. An install that switches a plugin on writes that rule
 * (`publish-installation.ts`).
 */
export function pluginTrustClass(plugin: DiscoveredPlugin): TrustClass {
  return trustClassOf({
    isBundled: plugin.builtin === true,
    isCodeBearing: false,
    defaultEnabled: plugin.manifest.defaultEnabled,
  })
}
