import path from 'node:path'

import type { ConfirmGrantOption } from '@localixai/mini-app-sdk/backend'
import { describeGrantRule, type GrantOption } from '../../../agent-core/permission-grant-scope'

/**
 * The two ends of a confirmation card that the requester must not improvise: what the card
 * SAYS, and what an answer to it is allowed to MEAN.
 *
 * The answer arrives as `unknown` from a client — the desktop card, a channel plugin, anything
 * holding the request id — so every field is re-read against what this host offered. A grant id
 * the card did not list widens nothing; that is what keeps "pick a folder" from becoming "name
 * any folder".
 */

/** Long enough for a paragraph of direction, short enough that a paste cannot flood a turn. */
export const MAX_REPLY_CHARS = 2000

export interface ConfirmAnswer {
  confirmed: boolean
  scope: 'once' | 'session' | 'always'
  /** The offered breadth a widening answer chose; absent for `once` or an id never offered. */
  grant?: GrantOption
  /** What the person wrote back, trimmed and bounded. */
  message?: string
}

export function readConfirmAnswer(raw: unknown, offered: readonly GrantOption[]): ConfirmAnswer {
  const answers = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const confirmed = answers.confirmed === true
  const scope = answers.scope === 'session' || answers.scope === 'always' ? answers.scope : 'once'
  // A client that predates the level picker names no grant: the narrowest one is the reading
  // that can never be wider than what the person saw.
  const grant =
    scope === 'once'
      ? undefined
      : typeof answers.grant === 'string'
        ? offered.find((option) => option.scope === answers.grant)
        : offered[0]
  const message =
    typeof answers.message === 'string'
      ? answers.message.trim().slice(0, MAX_REPLY_CHARS)
      : undefined
  return { confirmed, scope, ...(grant ? { grant } : {}), ...(message ? { message } : {}) }
}

/** The wire form: the rule in the spelling Settings shows, the scope as an opaque id. */
export function wireGrants(grants: readonly GrantOption[]): ConfirmGrantOption[] {
  return grants.map((grant) => ({
    id: grant.scope,
    kind: grant.kind,
    label: grant.label,
    covers: grant.covers,
    ...(grant.target ? { target: grant.target } : {}),
    ...(grant.rule ? { rule: describeGrantRule(grant.rule) } : {}),
  }))
}

/** The verb a core file tool performs on a path; any other tool is "used on" it. */
const PATH_VERBS: Record<string, string> = {
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  search: 'Search',
  skill: 'Change',
}

/**
 * One grammar on every card: an imperative naming what will happen if you approve.
 *
 * It was `Run <tool>` for everything, which reads as nonsense for most of them — "Run read for
 * a sub-agent" is the card that prompted this. The title now names the act and its object
 * ("Read useTheme.ts", "Run a command"), and WHO asked moves to the line under it, where a
 * sub-agent's task title fits instead of being squeezed into a clause.
 */
export function confirmTitle(input: {
  toolName: string
  subject?: 'command' | 'path' | 'resource'
  targets?: readonly string[]
}): string {
  const { toolName, subject = 'command', targets = [] } = input
  if (subject === 'command') return toolName === 'bash' ? 'Run a command' : `Run ${toolName}`
  if (subject === 'path') {
    const object =
      targets.length === 1 ? path.basename(targets[0]!) || targets[0]! : `${targets.length} paths`
    const verb = PATH_VERBS[toolName]
    return verb ? `${verb} ${object}` : `Use ${toolName} on ${object}`
  }
  return `Use ${toolName}`
}
