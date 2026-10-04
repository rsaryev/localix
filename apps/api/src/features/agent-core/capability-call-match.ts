import type { CallClass } from '@localixai/agent/agents'

import { matches, type Effect } from '../capabilities/rule'
import { matchesResourceClass } from '../capabilities/resource-classes'
import type { CallFacts } from './permission-facts'
import { splitCompoundCommand } from './tools/bash/bash-command-shape'

/**
 * Capability resources use the same anchored glob grammar in previews and live calls — except
 * for the named CLASSES, which are answered by `resource-classes.ts` rather than compared as
 * text. That module is the one list: a class added there is matched here without this file
 * learning its name.
 *
 * The call's CLASS (`effect`, `irreversible`, `needsHuman`) is something this seam cannot
 * answer — it is the TOOL's verdict on its input, not a fact read off paths and commands — so
 * the caller supplies it (`permission-engine.ts` holds `ToolFacts`). Absent means a caller with
 * no tool in hand (a rule preview), which is judged as a read.
 */
export function matchesCapabilityCall(
  pattern: string,
  effect: Effect,
  call: CallFacts,
  callClass: CallClass = { effect: 'read' },
): boolean {
  const classVerdict = matchesResourceClass(pattern, {
    ...call,
    effect: callClass.effect,
    irreversible: callClass.irreversible === true,
    needsHuman: callClass.needsHuman === true,
  })
  if (classVerdict !== undefined) return classVerdict
  const commands = call.commands ?? (call.command ? [call.command] : [])
  const parsed = commands.map((command) => splitCompoundCommand(command))
  const declared = call.resources ?? []
  const resources = [...declared, ...call.paths, ...parsed.flatMap((segments) => segments ?? [])]
  if (effect === 'allow') {
    const targets = [
      ...declared,
      ...(commands.length > 0 ? parsed.flatMap((segments) => segments ?? []) : call.paths),
    ]
    // Unknown shell expansion cannot establish authority for everything it executes.
    return (
      !parsed.includes(null) &&
      targets.length > 0 &&
      targets.every((resource) => matches(pattern, resource))
    )
  }
  return [...resources, ...commands].some((resource) => matches(pattern, resource))
}
