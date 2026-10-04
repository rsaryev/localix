import { actionFor } from '../capabilities/resolve'
import type { RuleChange } from '../capabilities/rule-changes'

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string'))]
    : []

/**
 * Translate a `.mcp.json` entry's tool filters into rules, at import.
 *
 * Claude Code's format lets a server entry carry `enabledTools` (only these) and
 * `disabledTools` (not these). Both are statements about what may run, so they belong in the
 * rule store like every other one — kept on the record instead, they would be a second place
 * that answers "may this tool run", unscoped, and invisible to the screen that claims to
 * show the whole policy.
 *
 * An allowlist becomes a CLOSED list: deny the server's tools as a family, then allow the
 * named ones back. Within a scope the last match wins, so the order here is the semantics.
 * An empty allowlist is treated as no allowlist, because an accidental `[]` should not
 * silently hide every tool a server exposes.
 */
export function importedToolRules(
  serverName: string,
  config: Record<string, unknown>,
): RuleChange[] {
  const allowed = stringList(config.enabledTools)
  const denied = stringList(config.disabledTools)
  const changes: RuleChange[] = []

  if (allowed.length > 0) {
    changes.push({
      action: actionFor('mcp', `${serverName}/*`),
      resource: '*',
      effect: 'deny',
    })
    for (const tool of allowed) {
      changes.push({
        action: actionFor('mcp', `${serverName}/${tool}`),
        resource: '*',
        effect: 'allow',
      })
    }
  }
  for (const tool of denied) {
    changes.push({
      action: actionFor('mcp', `${serverName}/${tool}`),
      resource: '*',
      effect: 'deny',
    })
  }
  return changes
}
