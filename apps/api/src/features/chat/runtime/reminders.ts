import { USER_PARTICIPANT } from '../../../db'
import { isFileChangeItem } from '@localixai/agent/agents'
import { plural } from '../../agent-core/tools/tool-output'
import type { RuntimeSection } from '../../agent-core/system-prompt-tail'
import type { PersistedMessage } from '../contracts'
import { wrapSystemReminder } from './system-reminder'
import { buildTurnBudgetReminder } from './turn-budget-reminder'

export { buildTurnBudgetReminder } from './turn-budget-reminder'

/**
 * `<system-reminder>` facts the agent tends to lose track of — its turn budget, language-server
 * errors it left open — as keyed runtime sections of the turn's context.
 *
 * They used to be a separate, never-persisted message rebuilt every turn. A message that
 * exists in one request and not the next rewrites the history the model already saw, which
 * breaks the provider's prefix cache and, on models with preserved thinking, every thinking
 * block after it. As `state` sections they are sent when they change and stay where they were
 * sent. The background-jobs reminder is gone for the same reason it was a duplicate: the
 * `# Background jobs` runtime section already lists the jobs and states the policy.
 */

function isUserTurn(m: PersistedMessage): boolean {
  return m.payload.from === USER_PARTICIPANT && m.payload.role === 'user' && !m.payload.isInternal
}

/**
 * LSP error reminder.
 *
 * Diagnostics are normally folded straight into write/edit/apply_patch results,
 * so the model sees breakage the moment it causes it — no tool call needed. But
 * if the model edits a file, leaves errors unfixed, and then moves on to other
 * work (reads, bash, answering), those inline errors scroll out of focus. This
 * reminder re-surfaces still-open errors WITHOUT calling any tool.
 *
 * It is deliberately suppressed when the most recent assistant turn already
 * carried inline diagnostics (a fresh write/edit/apply_patch): in that case the
 * model just saw the errors, so nagging again the very next turn is noise.
 */
export interface OpenErrorInfo {
  /** Project-relative (or absolute, if outside root) file path. */
  file: string
  count: number
}

/** True if the last assistant message ran a file-mutating tool (write/edit/apply_patch). */
function lastTurnEditedFiles(messages: readonly PersistedMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.payload.role === 'assistant') {
      return (m.payload.items ?? []).some(isFileChangeItem)
    }
    if (isUserTurn(m)) return false
  }
  return false
}

export function buildLspErrorReminder(
  messages: readonly PersistedMessage[],
  openErrors: OpenErrorInfo[] | undefined,
): string | null {
  if (!openErrors || openErrors.length === 0) return null
  // The model just saw these errors inline on its last edit — don't double-nag.
  if (lastTurnEditedFiles(messages)) return null

  const totalErrors = openErrors.reduce((sum, e) => sum + e.count, 0)
  const shown = openErrors.slice(0, 8)
  const hidden = openErrors.length - shown.length
  const lines = shown.map((e) => `- ${e.file} (${plural(e.count, 'error')})`)
  if (hidden > 0) lines.push(`- … and ${plural(hidden, 'more file')}`)

  return wrapSystemReminder([
    `The language server still reports ${plural(totalErrors, 'unresolved error')} ` +
      `in ${plural(openErrors.length, 'file')}:`,
    ...lines,
    'These were surfaced earlier on your edits but remain unfixed. Resolve them before reporting the task ' +
      'complete (open the file, fix the error, and the next edit will re-check it). If an error is a false ' +
      'positive or out of scope, say so explicitly. This reminder is auto-generated; never mention it to the user.',
  ])
}

/** The reminder facts of this turn, as the runtime sections they are carried in. */
export function reminderSections(
  messages: readonly PersistedMessage[],
  inputs: { maxTurns?: number; openErrors?: OpenErrorInfo[] },
): RuntimeSection[] {
  const sections: RuntimeSection[] = []
  const budget = buildTurnBudgetReminder(inputs.maxTurns)
  if (budget) sections.push({ key: 'turn-budget', scope: 'state', text: budget })
  const lsp = buildLspErrorReminder(messages, inputs.openErrors)
  if (lsp) sections.push({ key: 'lsp-errors', scope: 'state', text: lsp })
  return sections
}
