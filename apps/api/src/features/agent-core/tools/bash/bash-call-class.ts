import type { CallClass } from '@localixai/agent/agents'
import { stringToArray } from '../tool-schema'
import { isTerminalAction, terminalActionCommandCandidates } from '../terminal/terminal'
import { isDangerous } from './bash-command-safety'
import { isReadOnlyCommand } from './bash-readonly-classify'

/**
 * One `bash` call's class, for the permission gate BEFORE the call runs.
 *
 * The defect this exists to stop: bash's static `mutates: true` made every call `external`, so a
 * plan session could not run `git status` or `ls`, while the read-only judgement the gate used to
 * draw from the command lived in the facts layer, apart from the tool that knows its own input
 * shapes. So bash answers per call, mirroring `execute`'s dispatch order exactly — an
 * interactive action first, then a non-empty `commands[]` batch (always foreground), then the
 * single `command` — because judging a field execute ignores would make the gate and the tool
 * disagree about what runs.
 *
 * - Every command read-only (`isReadOnlyCommand`) → `read` in the foreground. A read-only command
 *   in the BACKGROUND (`background`, `notify`, or an `until` monitor) is still a durable job or a
 *   trigger this session owns, so it is `session`, never `read`.
 * - Anything else runs a process whose effects nothing here can predict → `external`, and a
 *   dangerous one (`rm -rf`, `git push --force`, `kubectl delete`, …) is `irreversible`.
 * - PTY: `screen`/`list`/`wait` only observe → `read`. `close` kills the program → `external`,
 *   irreversible. `open`/`type`/`keys` drive a live program whose foreground process is unknown
 *   here — read-only-looking text typed into a database shell is not a read — so they are
 *   `external`, irreversible when the text is dangerous.
 * - An input this cannot place (no command, a non-string entry, an unknown action) → `external`.
 */
const READ: CallClass = { effect: 'read' }
const SESSION: CallClass = { effect: 'session' }
const EXTERNAL: CallClass = { effect: 'external' }
const IRREVERSIBLE: CallClass = { effect: 'external', irreversible: true }

const OBSERVING_TERMINAL_ACTIONS: ReadonlySet<string> = new Set(['screen', 'list', 'wait'])

function external(commands: readonly string[]): CallClass {
  return commands.some((command) => isDangerous(command)) ? IRREVERSIBLE : EXTERNAL
}

function classifyTerminalCall(call: Record<string, unknown>): CallClass {
  if (OBSERVING_TERMINAL_ACTIONS.has(call.action as string)) return READ
  if (call.action === 'close') return IRREVERSIBLE
  return external(terminalActionCommandCandidates(call) ?? [])
}

/** The commands execute would run, in its own precedence; null when it would run none. */
function commandsOf(call: Record<string, unknown>): { commands: string[]; batch: boolean } | null {
  const batch = stringToArray(call.commands)
  if (Array.isArray(batch) && batch.length > 0) {
    if (!batch.every((entry) => typeof entry === 'string' && entry.trim())) return null
    return { commands: batch as string[], batch: true }
  }
  if (call.commands !== undefined && !Array.isArray(batch)) return null
  if (typeof call.command === 'string' && call.command.trim()) {
    return { commands: [call.command], batch: false }
  }
  return null
}

export function classifyBashCall(input: unknown): CallClass {
  if (!input || typeof input !== 'object') return EXTERNAL
  const call = input as Record<string, unknown>
  if (call.action !== undefined && call.action !== null) {
    return isTerminalAction(call.action) ? classifyTerminalCall(call) : EXTERNAL
  }
  const run = commandsOf(call)
  if (!run) return EXTERNAL
  if (!run.commands.every((command) => isReadOnlyCommand(command))) return external(run.commands)
  // `until` is a background job by construction (execute says the same); a batch never is.
  const background = !run.batch && (call.background === true || call.until !== undefined)
  return background ? SESSION : READ
}
