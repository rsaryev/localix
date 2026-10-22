import { issue, type PluginIssue } from './issues'

/**
 * Plugin names. Every component is namespaced under one (`/<plugin>:<skill>`), so a name may not
 * hold a space, `@`, `:`, a path separator, a control character or a bidi override. kebab-case is
 * the convention; anything else is a warning.
 */
// oxlint-disable-next-line no-control-regex -- the rule is precisely "no control characters"
const FORBIDDEN = /[\s@:/\\\u0000-\u001f\u007f‪-‮⁦-⁩]/u
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Names Anthropic keeps for its own plugins, compared case-insensitively with runs of separators folded. */
const RESERVED_EXACT = new Set(['claude', 'anthropic', 'anthropics', 'claude-code', 'claude-mods'])
const RESERVED_PREFIXES = ['claude-', 'anthropic-', 'anthropics-', 'cc-plugin-']
const BRAND_WORDS = new Set(['claude', 'anthropic', 'anthropics'])

const folded = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/**
 * Problems with `name` as a plugin name: an error stops the plugin, a warning does not. A reserved
 * name is an error to `claude plugin validate`, `init` and `tag`, but Claude Code still installs
 * and loads such a plugin (Anthropic's own carry one): pass `reserved: false` when loading.
 */
export function checkPluginName(
  name: string,
  path = 'name',
  options: { reserved?: PluginIssue['severity'] | false } = {},
): PluginIssue[] {
  if (!name.trim()) return [issue('error', path, 'Plugin name is empty')]
  if (FORBIDDEN.test(name))
    return [
      issue(
        'error',
        path,
        `Plugin name "${name}" may not contain spaces, "@", ":", path separators or control characters`,
      ),
    ]
  const found: PluginIssue[] = []
  const key = folded(name)
  const words = key.split('-')
  const nearOfficial =
    words.includes('official') && words.some((word) => word === 'claude' || word === 'anthropic')
  // Loading passes `reserved: false`: the rule is the validator's and the scaffolder's.
  const checksReserved = options.reserved !== false
  const reserved =
    RESERVED_EXACT.has(key) ||
    RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
    nearOfficial
  if (checksReserved && reserved) {
    found.push(
      issue(
        options.reserved || 'error',
        path,
        `Plugin name "${name}" is reserved: it passes as one of Anthropic's own`,
      ),
    )
  } else if (checksReserved && words.some((word) => BRAND_WORDS.has(word))) {
    found.push(issue('warning', path, `Plugin name "${name}" reads as one of Anthropic's own`))
  }
  if (!KEBAB.test(name))
    found.push(issue('warning', path, `Plugin name "${name}" is not kebab-case`))
  return found
}
