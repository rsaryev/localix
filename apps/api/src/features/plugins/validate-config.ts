import type { DiscoveredPlugin } from './discovery'
import type { PluginConfigValues } from './config'
import { mcpShellFieldRefusals } from './kit'
import { isRequiredConfigMissing } from '../ext/manifest-validate'

/**
 * Localix's checks of a plugin's `userConfig` options, which Claude Code's own validator does not
 * make. Named:
 * - an MCP server's shell-run field that references a plugin option, which does not load (the
 *   kit refuses it when the server resolves; this says so before, in the kit's words);
 * - an option the Settings form would show without a description;
 * - a credential-looking option not marked `sensitive` (its value would show in Settings), and a
 *   sensitive one with a default (visible in the manifest);
 * - `required` with a default, and a default of another type than the option's;
 * - a required option not set (with the person's values).
 */
export function validatePluginConfig(
  plugin: DiscoveredPlugin,
  warnings: string[],
  opts?: { config?: PluginConfigValues },
): void {
  // An undeclared `${VAR}` in an MCP config reads the environment, as in Claude Code: no warning.

  // Options, sensitive ones included, substitute anywhere in an MCP server's config, as in Claude
  // Code — except a field run through a shell: the kit refuses such a server.
  warnings.push(...mcpShellFieldRefusals(plugin.entrypoints.mcpServers))

  // Validate config fields — description, required+default inconsistency, type mismatch, and unset required.
  for (const [key, opt] of Object.entries(plugin.manifest.config ?? {})) {
    if (!opt.description.trim()) {
      warnings.push(
        `Config "${key}" has no description — add a description so users know what to enter in Settings.`,
      )
    }
    if (opt.required && opt.default !== undefined) {
      warnings.push(
        `Config "${key}" is "required: true" but also has a default — either remove "required" or remove the default (a default makes it not truly required).`,
      )
    }
    // Config key name or description looks like a credential but isn't marked secret.
    // Matches: exact credential names + suffix patterns (*_API_KEY, *_TOKEN, *_SECRET).
    const looksLikeSecret =
      /^(api_?key|api_?token|access_?token|auth_?token|secret_?key|private_?key|bot_?token|auth_?key|password|credential|SECRET)$/i.test(
        key,
      ) ||
      /_(api_?key|api_?token|access_?token|auth_?token|secret|webhook_?token|bot_?token|password)$/i.test(
        key,
      ) ||
      /\b(api key|api token|access token|auth token|secret key|private key|bot token|password)\b/i.test(
        opt.description,
      )
    if (looksLikeSecret && !opt.secret) {
      warnings.push(
        `Config "${key}" looks like a credential but is not sensitive — add "sensitive": true to its userConfig option to mask the value in Settings.`,
      )
    }
    if (opt.secret && opt.default !== undefined && opt.default !== '') {
      warnings.push(
        `Config "${key}" is "sensitive": true but also has a non-empty default — the default value will be visible in the manifest, defeating the purpose of marking it sensitive.`,
      )
    }
    if (opt.default !== undefined) {
      const defaultType = opt.default === null ? 'null' : typeof opt.default
      if (opt.type === 'number' && defaultType !== 'number') {
        warnings.push(
          `Config "${key}" has type "number" but its default value "${opt.default}" is ${defaultType}.`,
        )
      } else if (opt.type === 'boolean' && defaultType !== 'boolean') {
        warnings.push(
          `Config "${key}" has type "boolean" but its default value "${opt.default}" is ${defaultType}.`,
        )
      }
    }
    if (opts?.config) {
      const value = opts.config[key]
      if (isRequiredConfigMissing(opt, value)) {
        warnings.push(`Required config "${key}" is not set.`)
      }
    }
  }
}
