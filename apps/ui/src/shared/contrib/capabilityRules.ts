import type { CapabilityRuleChange } from '@/shared/api/contracts'

/**
 * THE SUGAR — and the only place in the client that spells a capability action.
 *
 * The server has no notion of a capability being "enabled": a switch is a rule, and the wire
 * says so (`{action, resource, effect}`). That is deliberate — one vocabulary, one store, one
 * answer the settings screen and the run both read. But a person does not want to type
 * `skill:deploy * deny` to hide a skill, so the four registry tabs still render a switch and
 * translate it here.
 *
 * Keeping the translation in ONE module is the whole point. Assembled at each call site, the
 * action string drifted: five spellings of the same prefix on the server was how this feature
 * got its worst bugs, and a client that hand-rolls `mcp:${server}/${tool}` in three components
 * would repeat them.
 */

/** The kinds a rule can name. Mirrors the server's `ACTION_PREFIX`, which owns the list. */
export type CapabilityKind = 'tool' | 'skill' | 'plugin' | 'mcp' | 'agent'

/** `tool:bash`, `skill:deploy`, `plugin:office`, `agent:builtin:qa`. */
export const capabilityAction = (kind: CapabilityKind, name: string): string => `${kind}:${name}`

/** One MCP server's tool, addressed as `mcp:<server>/<tool>`. */
export const mcpToolAction = (serverName: string, toolName: string): string =>
  capabilityAction('mcp', `${serverName}/${toolName}`)

/**
 * A switch, as a rule.
 *
 * ON writes an explicit `allow` rather than removing the row, for every kind alike. Absence
 * means "nobody decided", which sends an item back to its trust gate — and a dropped-in
 * plugin's gate answers OFF, so a removed row would silently undo the yes the user just gave.
 * An `allow` never widens anything either: composition takes the strictest verdict across
 * scopes, so it records a decision without unlocking what an outer scope forbids.
 */
export const availabilityChange = (
  kind: CapabilityKind,
  name: string,
  on: boolean,
): CapabilityRuleChange => ({
  action: capabilityAction(kind, name),
  resource: '*',
  effect: on ? 'allow' : 'deny',
})

/** Forget the decision entirely, sending the item back to its own default. */
export const clearAvailability = (kind: CapabilityKind, name: string): CapabilityRuleChange => ({
  action: capabilityAction(kind, name),
  resource: '*',
  effect: 'default',
})
