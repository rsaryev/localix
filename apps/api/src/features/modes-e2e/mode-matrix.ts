/**
 * THE MATRIX CHECKER — every (agent preset × mode × call) cell, against the decision table.
 *
 * One function used twice, by the real roster and by the positive control, because a checker
 * that only ever saw passing input proves nothing: the control feeds it a deliberately
 * misclassified tool and requires a finding. Findings are collected as sentences rather than
 * thrown at the first, so one run reports the whole shape of a regression.
 *
 * Three questions per call, in the order they depend on each other:
 *   1. does the TOOL classify the call as the case states (the classify table is right)?
 *   2. does the FACTS layer read the arguments as the case states (the baseline rows can fire)?
 *   3. does the real gate, under each mode and preset, give the table's answer?
 * A tool that fails 1 still runs 3 — what the misclassification COSTS is the useful half.
 */
import { classifyToolCall, type AgentTool } from '@localixai/agent/agents'

import { extractCallFacts } from '../agent-core/permission-engine'
import { PERMISSION_MODES } from '../capabilities/permission-modes'
import type { Rule } from '../capabilities/rule'
import { WORKSPACE, type CallCase } from './core-call-cases'
import { expectedDecision, modeSurface, type ModeSurface } from './run-surface'

export interface PresetUnderTest {
  handle: string
  rules: readonly Rule[]
  /** The preset's closed list, stated from its definition — not read back from the rules. */
  onRoster(tool: string): boolean
}

export async function matrixMismatches(
  presets: readonly PresetUnderTest[],
  cases: readonly CallCase[],
  tools: ReadonlyMap<string, AgentTool>,
  pluginNames: readonly string[],
): Promise<string[]> {
  const findings: string[] = []
  for (const call of cases) {
    const tool = tools.get(call.tool)
    if (!tool) {
      findings.push(`${call.tool}: no such tool was built`)
      continue
    }
    const actual = classifyToolCall(tool, call.input)
    if (JSON.stringify(normalize(actual)) !== JSON.stringify(normalize(call.cls)))
      findings.push(
        `${call.tool} (${call.label}): classified ${JSON.stringify(actual)}, the case says ${JSON.stringify(call.cls)}`,
      )
    const facts = extractCallFacts(call.tool, call.input, WORKSPACE, tool)
    const want = call.facts ?? {}
    for (const [name, seen] of [
      ['outside', facts.outsideWorkspace],
      ['dangerous', facts.dangerous],
      ['catastrophic', facts.catastrophic],
    ] as const)
      if (seen !== (want[name] === true))
        findings.push(`${call.tool} (${call.label}): facts.${name} is ${seen}`)
  }
  for (const preset of presets) {
    const surfaces = PERMISSION_MODES.map((mode) => modeSurface(preset.rules, mode, pluginNames))
    for (const call of cases) {
      const tool = tools.get(call.tool)
      if (!tool) continue
      for (const surface of surfaces) {
        const finding = await cellFinding(preset, surface, call, tool)
        if (finding) findings.push(finding)
      }
    }
  }
  return findings
}

async function cellFinding(
  preset: PresetUnderTest,
  surface: ModeSurface,
  call: CallCase,
  tool: AgentTool,
): Promise<string | null> {
  const where = `${preset.handle}/${surface.mode} ${call.tool} (${call.label})`
  const expected = expectedDecision(surface.mode, preset.onRoster(call.tool), call)
  const removed = surface.denied.includes(call.tool)
  if (expected === 'removed')
    return removed ? null : `${where}: kept on the roster, expected removed`
  if (removed) return `${where}: removed from the roster, expected ${expected}`
  const decision = await surface.decide(tool, call.input)
  return decision === expected ? null : `${where}: ${decision}, expected ${expected}`
}

/**
 * One call per action a contributed tool's schema offers, plus the bare call, classed by the
 * tool itself.
 *
 * Generic on purpose: core may not name a concrete plugin's tool, not even in a test
 * (`scripts/check-architecture.mjs`), so the hand-written half of a plugin's classes lives in the
 * plugin (`plugins/<name>/backend/classify.test.ts`). What core CAN prove for every contributed
 * call, whatever plugin ships it, is the other half: given the class the tool states, every mode
 * and preset answers by the decision table, and nothing in the gate throws on it.
 */
export function contributedCallCases(tools: readonly AgentTool[]): CallCase[] {
  return tools.flatMap((tool) => {
    // A bare call only for a tool with no `action`: the loop validates arguments BEFORE the gate
    // (`agent-loop.ts`), so an action-keyed tool never meets the gate without one.
    const actions = actionsOf(tool)
    const inputs: Record<string, unknown>[] = actions.length
      ? actions.map((action) => ({ action }))
      : [{}]
    return inputs.map((input) => ({
      tool: tool.name,
      label: typeof input.action === 'string' ? `action ${input.action}` : 'no action',
      input,
      cls: classifyToolCall(tool, input),
    }))
  })
}

/** The string literals of a zod object's `action` field, through `optional`/`default`. */
function actionsOf(tool: AgentTool): string[] {
  let field = (tool.inputSchema as { shape?: Record<string, unknown> } | undefined)?.shape?.action
  for (let depth = 0; depth < 4 && field; depth += 1) {
    const options = (field as { options?: unknown }).options
    if (Array.isArray(options)) return options.filter((value) => typeof value === 'string')
    field = (field as { unwrap?: () => unknown }).unwrap?.()
  }
  return []
}

/** `{irreversible: false}` and an absent flag are the same statement. */
const normalize = (cls: ReturnType<typeof classifyToolCall>) => ({
  effect: cls.effect,
  irreversible: cls.irreversible === true,
  needsHuman: cls.needsHuman === true,
})
