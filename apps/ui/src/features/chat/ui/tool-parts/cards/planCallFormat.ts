/**
 * WHAT ONE `plan` CALL DID, read from the call itself.
 *
 * `plan` is one tool with three actions (present | read | complete). A card that assumed every
 * call presented a version announced "Presented plan" for a call that only re-read it, and showed
 * nothing of a completion — the one call whose summary the person most wants to see. So the
 * action comes from the call INPUT (present is the default: a call without one is the old shape),
 * and the version from the stored plan in the result details when they are loaded, else from the
 * input's own `version`.
 */
import type { ToolCallItem } from '@localixai/agent/agents'

import { asRecord, numField, strField } from './format'

export type PlanCallAction = 'present' | 'read' | 'complete'

export interface PlanCallShape {
  action: PlanCallAction
  /** The version the call touched, when the call or its result names one. */
  plan: { id?: string; version?: number } | null
  /** The plan's title, from the stored version or the presenting call's input. */
  title?: string
  /** What the agent reported on `complete`. */
  summary?: string
}

function actionOf(value: string | undefined): PlanCallAction {
  return value === 'read' || value === 'complete' ? value : 'present'
}

export function planCallShape(item: Pick<ToolCallItem, 'input' | 'output'>): PlanCallShape {
  const input = asRecord(item.input)
  const stored = asRecord(asRecord(item.output)?.plan)
  const id = strField(stored, 'id') ?? strField(input, 'planId')
  const version = numField(stored, 'version') ?? numField(input, 'version')
  const summary = strField(input, 'summary') ?? strField(stored, 'completionSummary')
  return {
    action: actionOf(strField(input, 'action')),
    plan: id || version !== undefined ? { id, version } : null,
    title: strField(stored, 'title') ?? strField(input, 'title'),
    summary: summary?.trim() || undefined,
  }
}

/** The card's subtitle line: what happened, to which version. */
export function planCallSubtitle(shape: PlanCallShape): string {
  const version = shape.plan?.version
  const named = version !== undefined ? ` v${version}` : ''
  if (shape.action === 'read') return `Read plan${named}`
  if (shape.action === 'complete') return `Completed plan${named}`
  return `Presented plan${named}`
}
