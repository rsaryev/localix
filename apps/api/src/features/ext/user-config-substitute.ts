import { join } from 'node:path'

/**
 * The plugin data folder. The substitution of `${user_config.KEY}`, and the refusal of one in a
 * shell-run field, are the kit's.
 *
 * Pure module — no chat/UI imports.
 */

/**
 * CC `${CLAUDE_PLUGIN_DATA}` — persistent directory for plugin-owned user artifacts.
 * Resolves to `~/.localix/plugin-data/<id>`, `<id>` the plugin identifier (`name@marketplace`, or
 * the bare name for a plugin from no marketplace) with non-alphanumeric chars replaced by `-` (mirrors the CC spec which uses `~/.claude/plugins/data/<id>` —
 * we are a different host, so OUR canonical data dir is the substitution value).
 * Native plugins receive the same path as `ctx.dataDir`; opaque runtime state stays
 * separately under `ctx.stateDir`.
 */
export function pluginDataDir(pluginId: string, home: string): string {
  const root = join(home, '.localix', 'plugin-data')
  const dir = join(root, pluginId.replace(/[^a-zA-Z0-9_-]/g, '-'))
  return dir
}
