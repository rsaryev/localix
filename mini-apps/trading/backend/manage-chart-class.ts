/**
 * The permission class of one `manage_chart` call.
 *
 * Without it the tool is undeclared, and an undeclared tool is `external` — so a read-only plan
 * session refused `snapshot`, a pure read-back, and every chart command that changes nothing but
 * what the user is looking at. The line is what the call touches:
 *
 * - `snapshot` reads the tab's state and must not open or focus anything (`chart-command.ts`);
 *   `detect` is answered server-side from candles — both are reads, unless `detect` is told to
 *   `auto_draw`, which sends draw commands to the chart.
 * - every other action commands the chart tab the user sees: `view`, nothing durable.
 * - an action outside the enum is unknown, so `external`, never a read.
 */

import type { CallClass } from '@localixai/agent/agents'
import { CHART_ACTIONS } from './chart-command'

const READ_CALL: CallClass = { effect: 'read' }
const VIEW_CALL: CallClass = { effect: 'view' }
const UNKNOWN_CALL: CallClass = { effect: 'external' }

const VIEW_ACTIONS: ReadonlySet<string> = new Set<string>(
  CHART_ACTIONS.filter((action) => action !== 'snapshot'),
)

export function classifyManageChartCall(input: unknown): CallClass {
  const call = (input ?? {}) as { action?: unknown; auto_draw?: unknown }
  if (call.action === 'snapshot') return READ_CALL
  if (call.action === 'detect') return call.auto_draw === true ? VIEW_CALL : READ_CALL
  return typeof call.action === 'string' && VIEW_ACTIONS.has(call.action) ? VIEW_CALL : UNKNOWN_CALL
}
