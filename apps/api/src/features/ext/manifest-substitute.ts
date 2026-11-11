/**
 * Unified manifest token substituter — single source of truth for resolving
 * `${KEY}` forms in a plugin's output-style instructions (`plugins/output-styles.ts`); the kit
 * substitutes every other plugin text.
 *
 * ## Token forms supported
 *
 * | Form                          | Resolved to                                 |
 * | ----------------------------- | ------------------------------------------- |
 * | `${CLAUDE_PLUGIN_ROOT}`       | `pluginRoot`                                |
 * | `${CLAUDE_PLUGIN_DATA}`       | `dataDir`                                   |
 * | `${CLAUDE_PROJECT_DIR}`       | `projectDir`                                |
 * | `${user_config.KEY}`          | `config[KEY]` — case-sensitive, exact match |
 *
 * A bare `${KEY}` or `${CLAUDE_PLUGIN_OPTION_KEY}` stays as written, as in Claude Code.
 *
 * ## Casing (B3 fix)
 *
 * Config keys preserve the casing they were declared with in `plugin.json`.
 * All three config-key token forms match by exact key name — no uppercase/lowercase
 * coercion is applied. Previously the prompt path uppercased `CLAUDE_PLUGIN_OPTION_<KEY>`
 * while the MCP path lowercased it, causing bundled plugins (which use UPPERCASE keys
 * like `API_KEY`) to silently get empty string from the MCP path.
 *
 * ## Secret boundary
 *
 * The caller supplies `isSecret(key: string) => boolean`. The prompt/skill path passes
 * a real predicate that excludes keys whose manifest declares `secret: true`: such a token
 * becomes a placeholder naming the option, as Claude Code does in skill and agent content, so
 * the model sees that a value exists without seeing it. The security boundary stays with the
 * caller; this module is policy-agnostic.
 *
 * Pure module — no chat/UI imports, Node built-ins only.
 */

export interface SubstituterOptions {
  /** Plugin root directory → `${CLAUDE_PLUGIN_ROOT}`. */
  pluginRoot: string
  /** Plugin data directory → `${CLAUDE_PLUGIN_DATA}`. */
  dataDir: string
  /** Session project directory → `${CLAUDE_PROJECT_DIR}`. */
  projectDir: string
  /** Resolved config values (keys preserve declared casing). */
  config: Record<string, string | number | boolean>
  /**
   * Predicate: returns true when a config key holds a secret and must NOT be
   * substituted into the output.
   *
   * `(key) => Boolean(manifest.config?.[key]?.secret)`.
   */
  isSecret: (key: string) => boolean
}

/** What a sensitive option's token reads as in model-facing content (Claude Code's wording). */
function sensitiveOptionPlaceholder(key: string): string {
  return `[sensitive option '${key}' not available in skill content]`
}

/**
 * Build a substituter closure for a single plugin. The returned function replaces
 * every supported token form in a string with its resolved value. Call it once per
 * plugin and reuse across all texts that belong to that plugin.
 *
 * Tokens that reference an unknown config key resolve to `''` (same as before).
 * Tokens blocked by `isSecret` resolve to {@link sensitiveOptionPlaceholder}.
 */
export function makeSubstituter(opts: SubstituterOptions): (text: string) => string {
  const { pluginRoot, dataDir, projectDir, config, isSecret } = opts

  // Pre-build the list of substitutable config pairs (ordered by key so iteration
  // is deterministic; secret-guarding happens per-call via isSecret).
  const configEntries = Object.entries(config) as Array<[string, string | number | boolean]>

  return (text: string): string => {
    // 1. Path variables — simple string splitting, no regex needed.
    let out = text
      .split('${CLAUDE_PLUGIN_ROOT}')
      .join(pluginRoot)
      .split('${CLAUDE_PLUGIN_DATA}')
      .join(dataDir)
      .split('${CLAUDE_PROJECT_DIR}')
      .join(projectDir)

    // 2. Config tokens — replace all three forms for each key.
    //    We iterate the config entries so each key is applied once. The isSecret
    //    predicate controls whether the value is revealed in this context.
    for (const [key, rawVal] of configEntries) {
      const val = isSecret(key) ? sensitiveOptionPlaceholder(key) : String(rawVal)
      // Only Claude Code's `${user_config.KEY}`: a bare `${KEY}` is the text's own (a shell
      // variable in a skill), and `CLAUDE_PLUGIN_OPTION_<KEY>` is a hook process's variable.
      out = out.split(`\${user_config.${key}}`).join(val)
    }

    return out
  }
}
