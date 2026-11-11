import type { PluginManifest } from '@rsaryev/llx-plugin/format'
import type { PluginConfigOption } from './contracts-base'

/**
 * A plugin's manifest as Localix keeps it: the kit's (`.claude-plugin/plugin.json` as the kit read
 * it, under the name the kit loaded the plugin by) with the two facts Localix adds beside it
 * (`kit/catalog/manifest.ts`). Nothing the kit read is restated: a screen that shows a default
 * (no version, the author's name) derives it from these fields where it shows it. Nothing here is a
 * mini app's (rule X1): a plugin runs no Localix code.
 */
export type LocalixManifest = PluginManifest & {
  /**
   * The plugin's options as Localix settings: its `userConfig`, its channels' and its packaged
   * servers' (keyed `<server>.<key>`), `sensitive` read as `secret`, a list default as its JSON.
   */
  readonly config?: Readonly<Record<string, PluginConfigOption>>
  /** The plugin has a `plugin.json`: a Claude Code plugin, read in place. */
  readonly origin?: { readonly format: 'claude-code' }
}
