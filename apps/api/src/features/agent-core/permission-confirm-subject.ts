import type { CallClass } from '@localixai/agent/agents'

import { matchesCapabilityCall } from './capability-call-match'
import type { CallFacts } from './permission-facts'
import { pathGrants } from './permission-grant-paths'
import { programGrant, resourceGrant, type GrantOption } from './permission-grant-scope'

/**
 * WHAT a confirmation card shows, what kind of thing it is, and how far an approval of it may
 * reach — answered together, because the third follows from the first two.
 *
 * A shell call has a command; a file call has the paths it resolved; a tool that declares
 * native resources has those. Only when a call names none of them does the tool's own name
 * stand in. The subject used to be computed here and the grant derived later from the
 * displayed STRING alone, which is how a file's path came to be parsed as a shell program.
 */
export interface ConfirmSubject {
  /** The displayed subject: a command line, or one path/resource per line. */
  command: string
  subject: 'command' | 'path' | 'resource'
  /** The subject's items, as the grant is later matched against them. */
  targets: string[]
  /** Widening choices, narrowest first. Empty: the approval covers this one call. */
  grants: GrantOption[]
}

function subjectOf(
  call: CallFacts,
  toolName: string,
): Pick<ConfirmSubject, 'command' | 'subject' | 'targets'> {
  if (call.command) return { command: call.command, subject: 'command', targets: [] }
  // Outside paths first: when a call straddles the boundary, the part the rule is about is
  // the part worth reading at the top of a card.
  const paths = call.outsidePaths.length > 0 ? call.outsidePaths : call.paths
  if (paths.length > 0) return { command: paths.join('\n'), subject: 'path', targets: paths }
  const resources = [...(call.resources ?? [])]
  if (resources.length > 0) {
    return { command: resources.join('\n'), subject: 'resource', targets: resources }
  }
  return { command: toolName, subject: 'resource', targets: [] }
}

export function confirmSubject(
  call: CallFacts,
  toolName: string,
  callClass: CallClass = { effect: 'read' },
): ConfirmSubject {
  const shown = subjectOf(call, toolName)
  const offered =
    shown.subject === 'command'
      ? // A redacted line is a label, not the command: nothing about it can be granted.
        call.commandRedacted
        ? []
        : [programGrant(toolName, shown.command)].filter((g): g is GrantOption => !!g)
      : shown.subject === 'path'
        ? pathGrants(toolName, shown.targets)
        : [resourceGrant(toolName, shown.targets)].filter((g): g is GrantOption => !!g)
  // A rule is offered only if it would have allowed THIS call. The written rule is matched
  // against every fact of the call, the session grant only against the subject the card
  // showed — and where the two differ (a patch also names the directory it runs in) the
  // "Always" button would write a row that asks again on the very next call.
  const grants = offered.map((grant) =>
    grant.rule && !matchesCapabilityCall(grant.rule.resource, 'allow', call, callClass)
      ? { ...grant, rule: undefined }
      : grant,
  )
  return { ...shown, grants }
}
