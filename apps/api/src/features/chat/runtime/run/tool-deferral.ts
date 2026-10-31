import type { AgentTool } from '@localixai/agent/agents'

import type { DeferredToolEntry } from '../../../agent-core/tools/activate-tools/activate-tools'
import type { SessionRecord } from '../../repository'
import type { RunEnv } from './types'

/**
 * WHICH of a run's tools ride on the wire, and which wait behind `ToolSearch`.
 *
 * Split out of `tool-assembly.ts` because it is the one pure decision in that file: given
 * the wrapped tools, their provenance, and what this session already activated, it says
 * what the model sees. Assembly itself is all I/O — an MCP gather, hook wrapping, a
 * registry build — and mixing the two made the rule hard to read and impossible to test
 * without a run.
 */

/**
 * Split this run's tools into what rides on the wire and what stays behind the activator.
 *
 * The line is provenance for a tool the session has never asked for, and the SESSION for one it has:
 * `ToolSearch` used to hold its state in a per-run closure, so a promotion died with the turn and the
 * model spent a whole second turn re-activating a tool it had used two minutes earlier. The decision
 * belongs to the session, not the run.
 */
export function splitDeferredTools(
  wrapped: readonly AgentTool[],
  sourceByTool: ReadonlyMap<string, string>,
  activatedForSession: readonly string[],
  /** Tools an open mini app view or a mini app's wake brings to THIS turn (`surface-tools.ts`). */
  surfaceTools: readonly string[] = [],
): {
  /** Core tools: on the wire because every run works with them. */
  direct: AgentTool[]
  /** External tools on the wire: the session's activations, then this turn's surface tools. */
  promoted: AgentTool[]
  /** Every external tool, activated or not — the activator's authoritative name registry. */
  externalEntries: DeferredToolEntry[]
  /** External tools still behind the activator, i.e. what its catalog advertises. */
  deferredEntries: DeferredToolEntry[]
  /** Every external tool this turn carries, for the activator to answer "already active". */
  active: string[]
} {
  const direct: AgentTool[] = []
  const externalEntries: DeferredToolEntry[] = []
  const externalByName = new Map<string, AgentTool>()
  for (const tool of wrapped) {
    const source = sourceByTool.get(tool.name)
    if (!source) {
      direct.push(tool)
      continue
    }
    externalEntries.push({ tool: tool, source: source })
    externalByName.set(tool.name, tool)
  }
  // Activation ORDER, not name order: appending keeps the earlier part of the tool list byte-identical
  // from turn to turn, which is what a provider's prompt cache needs to keep hitting. Surface tools
  // follow the session's own, so a view opening or closing changes only the tail of the list. A name
  // that is not an external tool of this run (a core tool, one no longer loaded) is not promoted.
  const sticky = new Set(activatedForSession)
  const order = [...activatedForSession, ...surfaceTools.filter((name) => !sticky.has(name))]
  const promoted = order.flatMap((name) => {
    const tool = externalByName.get(name)
    return tool ? [tool] : []
  })
  const active = promoted.map((tool) => tool.name)
  const onWire = new Set(active)
  return {
    direct,
    promoted,
    externalEntries,
    deferredEntries: externalEntries.filter((entry) => !onWire.has(entry.tool.name)),
    active,
  }
}

/**
 * How many activated tools one session may carry on the wire.
 *
 * Sticky activation trades schema tokens for turns, and the trade stops paying at some point: a session
 * that wandered through every installed mini app would otherwise send every suite forever. The
 * oldest activation is dropped first, and dropping one costs nothing worse than one
 * `ToolSearch` call if the model needs it again.
 */
export const MAX_SESSION_ACTIVATED_TOOLS = 24

/** Merge newly activated names into a session's remembered set, newest kept, oldest trimmed. */
export function mergeActivatedTools(
  current: readonly string[],
  activated: readonly string[],
): string[] {
  const merged = [...current]
  for (const name of activated) if (!merged.includes(name)) merged.push(name)
  return merged.length > MAX_SESSION_ACTIVATED_TOOLS
    ? merged.slice(merged.length - MAX_SESSION_ACTIVATED_TOOLS)
    : merged
}

/**
 * The session's next remembered set, or `null` when the activation told it nothing new.
 *
 * Separate from the write so the decision is testable, and compared by CONTENT rather than by length:
 * at the cap a new activation trims the oldest name, so the list stays exactly as long while meaning
 * something different. A length test there would silently drop every activation past the cap.
 *
 * `released` names the tools the trim gave back, because a tool that disappears from the wire without a
 * word is the kind of thing an agent then spends turns being confused by.
 */
export function nextActivatedTools(
  current: readonly string[],
  activated: readonly string[],
): { next: string[]; released: string[] } | null {
  const next = mergeActivatedTools(current, activated)
  const unchanged =
    next.length === current.length && next.every((name, index) => name === current[index])
  if (unchanged) return null
  const kept = new Set(next)
  return { next, released: current.filter((name) => !kept.has(name)) }
}

/**
 * Persist an activation so the next run starts with the tool already on the wire.
 *
 * Best-effort on purpose: the activation itself already worked for THIS run (the runtime revealed the
 * schema), so a failed write costs one repeated call later and must never fail the tool.
 */
export async function rememberActivatedTools(
  env: RunEnv,
  userId: string,
  session: SessionRecord,
  activated: readonly string[],
): Promise<string[] | undefined> {
  const change = nextActivatedTools(session.activatedTools ?? [], activated)
  if (!change) return
  // The in-memory record is what the rest of this run reads, so a SECOND activation later in the same
  // run merges onto this one instead of onto the set the run started with.
  session.activatedTools = change.next
  try {
    // Merged onto what is STORED, not onto this run's copy: another run of the session (a
    // subagent's wake, a queued turn) may have activated tools since this one started.
    const stored = await env.repo.changeActivatedTools(userId, session.id, (current) =>
      nextActivatedTools(current, activated),
    )
    if (stored) {
      session.activatedTools = stored.next
      return stored.released
    }
  } catch {
    // Deliberately silent: see above.
  }
  return change.released
}
