import { sendTerminalInput } from './terminal-input'
import { INTERACTIVE_ACTIONS } from './terminal-schema'
import type { WaitOutcome } from './terminal-wait'
import type { ScreenSnapshot } from './terminal-job'
import type { TerminalWatch } from './terminal-activity'
import { settleScreen, renderScreen } from './terminal-screen'
import { waitForScreen } from './terminal-wait'
export { waitForScreen, type WaitOutcome } from './terminal-wait'
export { terminalActionFields, INTERACTIVE_ACTIONS } from './terminal-schema'

/**
 * Interactive-terminal actions, folded INTO the `bash` tool (not a separate tool):
 * `bash` with no `action` runs a shell command; `bash` with an `action` drives a
 * full-screen / interactive program (vim, REPLs, htop, arrow-key menus) in a live
 * PTY pane — reading the RENDERED screen (a VT emulator reconstructs the visible
 * grid) and sending named keystrokes. This module is the action handler; `bash.ts`
 * owns the tool definition and dispatches here when `action` is set.
 */

/**
 * Deps for the interactive actions — a thin, user+session-scoped view of the
 * terminal service (bound at wiring time in runtime-tools). Holds no ids beyond
 * the terminal_id the model passes back across turns.
 */
export interface TerminalToolDeps {
  open(input: {
    cwd?: string
    command: string
  }): Promise<{ terminalId: string; screen: ScreenSnapshot | null }>
  screen(terminalId: string): Promise<ScreenSnapshot | null>
  /** Final retained screen when a process exits before a render could read it. */
  finalScreen?(terminalId: string): Promise<ScreenSnapshot | null>
  /** Output/exit events that wake `wait` and the settle re-checks (see terminal-activity.ts). */
  watch: TerminalWatch
  write(terminalId: string, data: string): boolean
  list(): { terminalId: string; command?: string }[]
  close(terminalId: string): boolean
  /** Volatile activity hooks supplied by the chat runtime; no literal terminal input is exposed. */
  onWait?(event: { terminalId: string; active: boolean; label?: string }): void
  onInput?(event: { terminalId: string; label?: string }): void
}

export type TerminalAction = (typeof INTERACTIVE_ACTIONS)[number]

/** Permission-path identity for bash's interactive dispatch. Kept beside the action catalog so
 * adding an action cannot silently fall back to ordinary command classification. */
export function isTerminalAction(action: unknown): action is TerminalAction {
  return typeof action === 'string' && INTERACTIVE_ACTIONS.includes(action as TerminalAction)
}

/**
 * Shell-like text an interactive action can execute or stage for later execution.
 *
 * `null` means this is not an interactive action and ordinary `command`/`commands`
 * dispatch applies. Read actions return an empty list. `type` and `keys` are inspected even
 * without Enter: text can be staged in one call and submitted by a later key-only call.
 */
export function terminalActionCommandCandidates(input: {
  action?: unknown
  command?: unknown
  text?: unknown
  keys?: unknown
}): string[] | null {
  if (!isTerminalAction(input.action)) return null
  if (input.action === 'open') return typeof input.command === 'string' ? [input.command] : []
  if (input.action === 'type') {
    const text = typeof input.text === 'string' ? input.text : ''
    const keys =
      Array.isArray(input.keys) && input.keys.every((key) => typeof key === 'string')
        ? input.keys.join(' ')
        : ''
    return [text, keys, text + keys].filter(Boolean)
  }
  if (input.action === 'keys') {
    return Array.isArray(input.keys) && input.keys.every((key) => typeof key === 'string')
      ? [input.keys.join(' ')]
      : []
  }
  return []
}

/** UI detail shape for interactive actions (read by the terminal card). */
export interface TerminalDetails {
  action: TerminalAction
  terminalId?: string
  command?: string
  screen?: ScreenSnapshot | null
  state?: 'running' | 'exited' | 'unavailable'
  waitOutcome?: WaitOutcome
  screenChanged?: boolean
}

export interface TerminalActionResult {
  content: string
  details?: TerminalDetails
  isError?: boolean
  /** Live-state key so stale screen reads of the SAME terminal are superseded in context. */
  supersedeKey?: string
}

const EVENT_LABEL_LIMIT = 120

function boundedLabel(label: string): string {
  return label.length <= EVENT_LABEL_LIMIT ? label : `${label.slice(0, EVENT_LABEL_LIMIT - 1)}…`
}

function waitLabel(input: { wait_for?: string; wait_absent?: boolean }): string {
  if (!input.wait_for) return 'output to settle'
  return boundedLabel(input.wait_absent ? `until text disappears` : `until text appears`)
}

const SAFE_NAMED_KEY =
  /^(?:enter|return|tab|shift[+ _-]?tab|backtab|escape|esc|backspace|delete|del|insert|space|up|down|left|right|home|end|page[ _-]?up|pgup|page[ _-]?down|pgdn|f(?:[1-9]|1[0-2])|ctrl\+.|alt\+.)$/i

function inputLabel(input: { action: 'keys' | 'type'; keys?: string[] }): string {
  if (input.action === 'type') {
    const safeKeys = (input.keys ?? []).map((key) => (SAFE_NAMED_KEY.test(key) ? key : 'text'))
    return boundedLabel(safeKeys.length > 0 ? `text + ${safeKeys.join(' ')}` : 'text')
  }
  return boundedLabel(
    (input.keys ?? []).map((key) => (SAFE_NAMED_KEY.test(key) ? key : 'text')).join(' '),
  )
}

/**
 * Handle one interactive-terminal action. Called by `bash.execute` when `action`
 * is set. Adaptive settle: re-render on each output burst until output goes QUIET
 * (QUIET_MS without output) or a cap — a fixed pause would return a blank screen on
 * cold start (a `bun` REPL can take ~1s) or a stale screen after a keystroke.
 */
export async function runTerminalAction(
  deps: TerminalToolDeps,
  input: {
    action: TerminalAction
    command?: string
    cwd?: string
    terminal_id?: string
    keys?: string[]
    text?: string
    wait_for?: string
    wait_absent?: boolean
    wait_timeout_ms?: number
  },
  signal?: AbortSignal,
): Promise<TerminalActionResult> {
  const { action } = input
  if (signal?.aborted) return { content: 'INTERRUPTED: no terminal action sent.', isError: true }
  if (input.wait_absent && !input.wait_for) {
    return { content: 'wait_absent requires wait_for — say WHAT should disappear.', isError: true }
  }

  const observe = async (terminalId: string, maxMs: number): Promise<TerminalActionResult> => {
    if (action === 'wait' || input.wait_for || input.wait_timeout_ms !== undefined) {
      const label = waitLabel(input)
      deps.onWait?.({ terminalId, active: true, label })
      try {
        const result = await waitForScreen(deps, { terminalId, ...input }, signal)
        return { ...result, details: { ...result.details, action, terminalId } }
      } finally {
        deps.onWait?.({ terminalId, active: false, label })
      }
    }
    const snapshot = await settleScreen(
      deps,
      terminalId,
      { maxMs, needNonEmpty: action === 'open' },
      signal,
    )
    return {
      content: `Terminal ${terminalId}: ${snapshot.state}.\n${renderScreen(snapshot.screen)}`,
      details: { action, terminalId, ...snapshot },
      isError: snapshot.state === 'unavailable',
      supersedeKey: `terminal:${terminalId}`,
    }
  }

  if (action === 'list') {
    const open = deps.list()
    if (open.length === 0)
      return {
        content: 'No interactive terminals are open. Use action="open" to start one.',
      }
    const lines = open.map((t) => `- ${t.terminalId}: \`${t.command ?? 'shell'}\``)
    return { content: `Open terminals:\n${lines.join('\n')}` }
  }

  if (action === 'open') {
    if (!input.command)
      return {
        content: 'command is required for action="open".',
        isError: true,
      }
    const { terminalId } = await deps.open({
      cwd: input.cwd,
      command: input.command,
    })
    const result = await observe(terminalId, 3000)
    return {
      ...result,
      content: `Opened terminal ${terminalId} running \`${input.command}\`.\n${result.content}`,
      details: { ...result.details, action, terminalId, command: input.command },
    }
  }

  // All remaining actions target an existing terminal.
  if (!input.terminal_id) {
    return {
      content: `terminal_id is required for action="${action}". Call action="list" first.`,
      isError: true,
    }
  }
  const terminalId = input.terminal_id

  if (action === 'close') {
    const ok = deps.close(terminalId)
    return {
      content: ok ? `Closed terminal ${terminalId}.` : `No open terminal ${terminalId}.`,
      isError: !ok,
    }
  }

  if (action === 'screen' || action === 'wait') return observe(terminalId, 800)

  if (action === 'keys' && !input.keys?.length) {
    return { content: 'keys is required for action="keys".', isError: true }
  }
  if (action === 'type' && input.text == null) {
    return { content: 'text is required for action="type".', isError: true }
  }
  const sentLabel = inputLabel({ action, keys: input.keys })
  const before = await deps.screen(terminalId)
  const sent = await sendTerminalInput(
    deps,
    terminalId,
    { text: action === 'type' ? input.text : undefined, keys: input.keys },
    signal,
  )
  if (sent !== 'sent') {
    return {
      content:
        sent === 'interrupted'
          ? 'INTERRUPTED: remaining terminal input was not sent.'
          : `Terminal ${terminalId} exited or rejected input; remaining input was not sent.`,
      isError: true,
    }
  }
  deps.onInput?.({ terminalId, label: sentLabel })
  const result = await observe(terminalId, 1500)
  const after = result.details?.screen
  const screenChanged =
    before && after
      ? before.text !== after.text ||
        before.cols !== after.cols ||
        before.rows !== after.rows ||
        before.cursor.row !== after.cursor.row ||
        before.cursor.col !== after.cursor.col
      : undefined
  const unchanged =
    screenChanged === false && result.details?.state === 'running'
      ? '\nDisplay unchanged; input effect is unconfirmed. Follow the on-screen key hints.'
      : ''
  return {
    ...result,
    content: `Sent ${sentLabel} to terminal ${terminalId}.${unchanged}\n${result.content}`,
    details: { ...result.details, action, terminalId, screenChanged },
  }
}
