import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import { TOOL } from '../tool-names'
import { describeWithholdReason, type ToolLedger } from '../tool-ledger'
import { buildToolError } from './tool-errors'

/**
 * A dispatch-only stand-in for a tool the ledger WITHHELD.
 *
 * The agent loop answers a call to an unknown name with a bare "Tool X not found" — the same
 * words for a name that never existed, a tool a rule switched off, and a port the host never
 * wired. A stub in the dispatch registry (never in the model's schema list) turns that into
 * the ledger's sentence, and names the remedy when one exists and the run can propose it.
 *
 * Every withheld row is stubbed — built-in, mini app or MCP: the ledger knows each name it
 * withheld, and a name it never saw really is unknown.
 */
export function withheldToolStubs(ledger: ToolLedger, present: ReadonlySet<string>): AgentTool[] {
  const canPropose = ledger.get(TOOL.configure)?.state === 'live'
  const stubs: AgentTool[] = []
  for (const [name, verdict] of ledger) {
    if (verdict.state !== 'withheld' || present.has(name)) continue
    const reason = describeWithholdReason(verdict.reason)
    const remedy =
      verdict.remedy && canPropose
        ? ` Propose it with \`configure\`: {action:"propose", change:{kind:"${verdict.remedy.remedyId}", name:"${verdict.remedy.target}"}}.`
        : ' It cannot be enabled from this conversation; continue with the tools you have.'
    stubs.push(
      defineAgentTool({
        name,
        description: `Unavailable: ${reason}.`,
        inputSchema: z.record(z.string(), z.unknown()),
        activeVerb: 'Unavailable',
        // The stub runs nothing — it only answers with the ledger's sentence. Left unstated it
        // would read as `external`, and the gate would ask the person to approve (or a plan
        // session refuse) a call that does nothing, hiding the reason it is unavailable.
        mutates: false,
        async execute() {
          return buildToolError({
            kind: 'not_found',
            message: `\`${name}\` is unavailable in this run — ${reason}.${remedy}`,
          })
        },
      }) as AgentTool,
    )
  }
  return stubs
}
