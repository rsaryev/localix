import { SEALED_PLACEHOLDER } from '@localixai/agent/agents'
import type { AgentToolSealing } from '@localixai/agent/agents'
import type { ToolItemSpec } from './item-builders'

/** What a sealed result reads as in the transcript and in every later history rebuild. */
export const SEALED_RESULT_TEXT = 'Sealed result.'

/**
 * Withhold the values a tool's descriptor declares sealed from one tool item spec.
 *
 * Applied in the accumulator funnel, so the first streamed copy (`message_end` → `streamTool`,
 * before the tool runs), every progress update and the final result are all written already
 * sealed: no persisted row or published frame ever holds the real value. Idempotent.
 */
export function sealToolSpec(spec: ToolItemSpec, sealing: AgentToolSealing | undefined) {
  if (!sealing) return spec
  const sealed: ToolItemSpec = { ...spec }
  if (sealing.input?.length) sealed.input = sealInput(spec.input, sealing.input)
  if (sealing.result) {
    if (spec.details !== undefined) sealed.details = undefined
    if (spec.resultText !== undefined) sealed.resultText = SEALED_RESULT_TEXT
    if (spec.errorText !== undefined) sealed.errorText = SEALED_RESULT_TEXT
    if (spec.error !== undefined)
      sealed.error = {
        kind: spec.error.kind,
        message: SEALED_RESULT_TEXT,
        userMessage: SEALED_RESULT_TEXT,
      }
    if (spec.attachments !== undefined) sealed.attachments = undefined
    if (spec.sources !== undefined) sealed.sources = undefined
  }
  return sealed
}

function sealInput(input: unknown, keys: readonly string[]): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const record = input as Record<string, unknown>
  if (!keys.some((key) => key in record)) return input
  const sealed = { ...record }
  for (const key of keys) if (key in sealed) sealed[key] = SEALED_PLACEHOLDER
  return sealed
}
