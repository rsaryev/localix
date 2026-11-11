import type { UserConfigOption } from '@rsaryev/llx-plugin/format'

/**
 * The plugin feature's own primitives: the qualified name a command goes by, an option as a
 * Localix setting. Mini apps keep theirs in `@localixai/mini-app-sdk`; neither layer borrows the
 * other's (rule X1, `docs/internals/plugins-and-mini-apps.md`).
 */

/** A namespaced name, `<plugin>:<name>[:<name>…]`, as Claude Code addresses commands and agents. */
export const PLUGIN_QUALIFIED_NAME_RE = /^[a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)*$/i

/**
 * One option as a Localix setting, composed from the kit's `userConfig` option: `sensitive` is
 * `secret`, `required` and `secret` are always said, and a list default is kept as its JSON (the
 * scalar a setting stores, `config-lists.ts`). Built by `kit/catalog/manifest.ts`.
 */
export type PluginConfigOption = Omit<UserConfigOption, 'sensitive' | 'default' | 'required'> & {
  readonly required: boolean
  readonly secret: boolean
  readonly default?: string | number | boolean
}

/** The `userConfig` option types, as the kit reads them. */
export type PluginConfigType = UserConfigOption['type']

/** A plugin's resolved option values, by key. */
export type PluginConfigValues = Record<string, string | number | boolean>
