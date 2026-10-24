/**
 * A PermissionRequest hook's view of the card's widenings (hooks.md, "Permission update entries").
 * Each grant the card offers becomes `permission_suggestions` entries: `addRules` with
 * `behavior: "allow"` for the session, and, when the grant can be written as an "Always" rule, for
 * the settings destinations too. A hook that echoes one back as `updatedPermissions` gets what the
 * person would have got by picking it. An entry that is none of the suggestions widens nothing:
 * Localix only grants the breadths its own card would.
 */
import type { GrantOption } from '../../../agent-core/permission-grant-scope'
import { claudeCodeToolName } from '../../../ext/cc-tool-shapes'

const SETTINGS_DESTINATIONS = ['localSettings', 'projectSettings', 'userSettings'] as const

interface Suggestion {
  type: 'addRules'
  rules: { toolName: string; ruleContent?: string }[]
  behavior: 'allow'
  destination: 'session' | (typeof SETTINGS_DESTINATIONS)[number]
}

/** `bash(git)` → `git`; a bare tool grant names no content. */
const contentOf = (scope: string) => scope.match(/^[^(]+\((.*)\)$/)?.[1]

function suggestionsOf(grant: GrantOption, toolName: string): Suggestion[] {
  const content = contentOf(grant.scope)
  const rules = [{ toolName, ...(content ? { ruleContent: content } : {}) }]
  const destinations = grant.rule
    ? (['session', ...SETTINGS_DESTINATIONS] as const)
    : ['session' as const]
  return destinations.map((destination) => ({
    type: 'addRules',
    rules,
    behavior: 'allow',
    destination,
  }))
}

/** The card's widenings as Claude Code's `permission_suggestions`. */
export function permissionSuggestions(
  offered: readonly GrantOption[],
  toolName: string,
): Suggestion[] {
  const ccName = claudeCodeToolName({ name: toolName })
  return offered.flatMap((grant) => suggestionsOf(grant, ccName))
}

const sameEntry = (a: unknown, b: Suggestion) => JSON.stringify(a) === JSON.stringify(b)

/** The grants a hook's `updatedPermissions` picked, and whether each is to be written as a rule. */
export function grantsFromUpdates(
  updates: readonly unknown[] | undefined,
  offered: readonly GrantOption[],
  toolName: string,
): { grant: GrantOption; always: boolean }[] {
  if (!updates?.length) return []
  const ccName = claudeCodeToolName({ name: toolName })
  return offered.flatMap((grant) => {
    const picked = suggestionsOf(grant, ccName).filter((s) => updates.some((u) => sameEntry(u, s)))
    if (picked.length === 0) return []
    return [{ grant, always: picked.some((s) => s.destination !== 'session') }]
  })
}
