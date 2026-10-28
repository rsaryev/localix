/**
 * `ContextBudget` — how much of the request window this session has left.
 *
 * A model that can see its budget narrows its reads or saves
 * what matters before the host checkpoints its view; without it, the only signal it ever gets
 * is the checkpoint itself. Read-only, ~60 schema tokens, no arguments. The numbers are the
 * host's own budget frame plus its last measurement — the same ones the usage ring shows the
 * user — so the model and the person are looking at one figure.
 */
import { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'
import { TOOL } from '../tool-names'

/** The host's budget as plain numbers; the tool never learns the frame type behind them. */
export interface ContextBudgetReading {
  /** Whole-request ceiling the host budgets every request against. */
  triggerTokens: number
  /** The request size at which the host checkpoints the history (older turns → cards). */
  checkpointAtTokens: number
  /** The window the host budgets against (the model's, capped by policy). */
  policyWindowTokens: number
  /** The model's advertised window. */
  modelWindowTokens: number
  /** Space held back for the response. */
  reservedTokens: number
  /** System prompt + tool schemas, paid on every request. */
  fixedOverheadTokens: number
  /** Where the fixed cost goes, when the host can say. */
  fixed?: {
    promptTokens: number
    toolTokens: number
    toolCount: number
    /** The heaviest schemas, largest first. */
    heaviestTools: readonly { name: string; tokens: number }[]
  }
  /** Provider-measured size of the last request, when one was measured this run. */
  measuredTokens?: number
  /** The host's estimate when no measurement exists yet. */
  estimatedTokens?: number
}

const format = new Intl.NumberFormat('en-US')

function describeFixedBreakdown(fixed: ContextBudgetReading['fixed']): string {
  if (!fixed) return ''
  const heaviest = fixed.heaviestTools
    .map((tool) => `${tool.name} ${format.format(tool.tokens)}`)
    .join(', ')
  return ` — prompt ${format.format(fixed.promptTokens)}, ${fixed.toolCount} tool schemas ${format.format(fixed.toolTokens)}${heaviest ? ` (heaviest: ${heaviest})` : ''}`
}

export function describeContextBudget(reading: ContextBudgetReading): string {
  const used = reading.measuredTokens ?? reading.estimatedTokens
  const provenance =
    reading.measuredTokens !== undefined
      ? 'measured by the provider on the last request'
      : reading.estimatedTokens !== undefined
        ? 'estimated by the runtime (no provider measurement yet)'
        : 'unknown until the first request completes'
  const lines = [
    used === undefined
      ? `Context used: unknown (${provenance}).`
      : `Context used: ${format.format(used)} of ${format.format(reading.triggerTokens)} tokens (${Math.round((used / reading.triggerTokens) * 100)}%), ${provenance}.`,
    used === undefined
      ? ''
      : `Remaining before the next context checkpoint: ${format.format(Math.max(0, reading.checkpointAtTokens - used))} tokens.`,
    `Fixed per-request cost (system prompt + tool schemas): ${format.format(reading.fixedOverheadTokens)} tokens${describeFixedBreakdown(reading.fixed)}.`,
    `Budget: policy window ${format.format(reading.policyWindowTokens)} (model ${format.format(reading.modelWindowTokens)}), ${format.format(reading.reservedTokens)} reserved for the response.`,
    used !== undefined && used >= reading.checkpointAtTokens * 0.85
      ? 'Guidance: a checkpoint is near — finish the current step, avoid re-reading large files, and prefer `Search`/ranged `Read`. At the checkpoint older turns become short cards; anything whose reasons must survive belongs in memory.'
      : '',
  ]
  return lines.filter(Boolean).join('\n')
}

export function createContextBudgetTool(read: () => ContextBudgetReading | undefined) {
  return defineAgentTool<Record<string, never>, ContextBudgetReading | undefined>({
    name: TOOL.ContextBudget,
    label: 'Context budget',
    activeVerb: 'Checking context budget',
    description:
      'How much of the context window is used and what remains before the next context checkpoint. Call it before a large read or to decide whether to split a long task.',
    inputSchema: z.object({}),
    executionMode: 'parallel',
    mutates: false,
    async execute() {
      const reading = read()
      if (!reading) {
        return { content: 'Context budget is not available for this run.', details: undefined }
      }
      return { content: describeContextBudget(reading), details: reading }
    },
  })
}
