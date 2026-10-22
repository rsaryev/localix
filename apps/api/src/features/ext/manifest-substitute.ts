/**
 * Unified manifest token substituter — single source of truth for resolving
 * `${KEY}` forms in plugin manifests (MCP configs, agent prompts, skill content,
 * prompt sections).
 *
 * ## Token forms supported
 *
 * | Form                          | Resolved to                                 |
 * | ----------------------------- | ------------------------------------------- |
 * | `${CLAUDE_PLUGIN_ROOT}`       | `pluginRoot`                                |
 * | `${CLAUDE_PLUGIN_DATA}`       | `dataDir`                                   |
 * | `${CLAUDE_PROJECT_DIR}`       | `projectDir`                                |
 * | `${CLAUDE_PLUGIN_OPTION_KEY}` | `config[KEY]` — case-sensitive, exact match |
 * | `${user_config.KEY}`          | `config[KEY]` — case-sensitive, exact match |
 * | `${KEY}`                      | `config[KEY]` — case-sensitive, exact match |
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
 * the model sees that a value exists without seeing it. The MCP path does NOT use this module —
 * it has its own substituter (`ext/user-config-substitute.ts`) where sensitive options do
 * substitute. The security boundary stays with the caller; this module is policy-agnostic.
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
   * Prompt/skill path: `(key) => Boolean(manifest.config?.[key]?.secret)`.
   * (The MCP path uses `ext/user-config-substitute.ts` instead — env-only secrets.)
   */
  isSecret: (key: string) => boolean
}

/** What a sensitive option's token reads as in model-facing content (Claude Code's wording). */
export function sensitiveOptionPlaceholder(key: string): string {
  return `[sensitive option '${key}' not available in skill content]`
}

/**
 * Given a `${…}` token (the part inside the braces), resolve which config key
 * it refers to — stripping the known CC prefix forms — and return it verbatim
 * so the caller can look it up against the real config object.
 *
 * The returned key is NEVER coerced in casing; the caller must match it against
 * the config as-is. This is the core fix for B3: previously the MCP path
 * lowercased the key here, causing `${CLAUDE_PLUGIN_OPTION_API_KEY}` to look up
 * `api_key` while the config object held `API_KEY`.
 */
export function normalizeTokenKey(token: string): string {
  if (token.startsWith('CLAUDE_PLUGIN_OPTION_')) return token.slice('CLAUDE_PLUGIN_OPTION_'.length)
  if (token.startsWith('user_config.')) return token.slice('user_config.'.length)
  return token
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
      out = out
        .split(`\${user_config.${key}}`)
        .join(val)
        .split(`\${${key}}`)
        .join(val)
        .split(`\${CLAUDE_PLUGIN_OPTION_${key}}`)
        .join(val)
    }

    return out
  }
}
