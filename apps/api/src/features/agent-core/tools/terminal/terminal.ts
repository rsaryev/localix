import { z } from 'zod'
import { encodeKeys } from './terminal-keys'
import type { ScreenSnapshot } from './terminal-job'
import { watchTerminalActivity, type TerminalWatch } from './terminal-activity'

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

export const INTERACTIVE_ACTIONS = [
  'open',
  'screen',
  'keys',
  'type',
  'wait',
  'list',
  'close',
] as const
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
  if (input.action === 'type') return typeof input.text === 'string' ? [input.text] : []
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
}

export interface TerminalActionResult {
  content: string
  details?: TerminalDetails
  isError?: boolean
  /** Live-state key so stale screen reads of the SAME terminal are superseded in context. */
  supersedeKey?: string
}

/**
 * Bounds for action="wait". The default is generous enough for the cases that
 * drove this (a dev server compiling, an installer, a REPL warming up) without a
 * typo'd `wait_for` parking the agent for minutes; the max is the hard ceiling on
 * how long ONE tool call may block a turn.
 */
const DEFAULT_WAIT_MS = 15_000
const MAX_WAIT_MS = 120_000

/** Zod fields the `bash` schema merges in to expose the interactive actions. */
export const terminalActionFields = {
  action: z
    .enum(INTERACTIVE_ACTIONS)
    .optional()
    .describe(
      'Omit to run a command. PTY: "open" (with command) returns a terminal_id; "screen" reads the display (read, act, read again — never re-screen in a loop); "keys"/"type" send input; "wait" blocks until `wait_for` shows; "list"/"close".',
    ),
  terminal_id: z.string().optional().describe('From open/list; required except for open/list.'),
  keys: z
    .array(z.string())
    .optional()
    .describe(
      'Named keys (Enter, Escape, Up, Ctrl+C…) or literal text, in order; with type, pressed after the text.',
    ),
  text: z.string().optional().describe('type: literal text.'),
  wait_for: z
    .string()
    .optional()
    .describe('wait: screen text to wait for (omit to wait for quiet output).'),
  wait_absent: z.boolean().optional().describe('wait: until `wait_for` disappears instead.'),
  wait_timeout_ms: z
    .number()
    .int()
    .min(100)
    .max(MAX_WAIT_MS)
    .optional()
    .describe(`wait: cap in ms (default ${DEFAULT_WAIT_MS}, max ${MAX_WAIT_MS}).`),
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
/** No output for this long = the screen went quiet (the old poll's two-equal-frames gap). */
const QUIET_MS = 80
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

function renderScreen(s: ScreenSnapshot | null): string {
  if (!s)
    return '(screen unavailable — the terminal has exited or the id is unknown; call action="list")'
  if (s.text.trim() === '') {
    return `screen ${s.cols}×${s.rows} is blank — the program is still starting or waiting silently. Call action="screen" again in a moment.`
  }
  return `screen ${s.cols}×${s.rows}, cursor at row ${s.cursor.row} col ${s.cursor.col}:\n${s.text}`
}

/** Why a `wait` returned — the model must never have to guess. */
export type WaitOutcome = 'matched' | 'vanished' | 'quiet' | 'timeout' | 'exited' | 'interrupted'

/**
 * action="wait" — block until the screen says what the agent is waiting for.
 *
 * Without this, waiting is polling: the agent calls action="screen" over and over
 * (each a full model round-trip carrying a whole screen into context) until the
 * text it wants shows up. `screen` already settles, but only for output QUIET and
 * only up to 800ms — a dev server compiling for 20s or an installer looks exactly
 * like a quiet screen, so settling answers the wrong question. This waits on the
 * CONTENT instead, in one call.
 *
 * The three conditions mirror what a human does at a terminal: wait for something
 * to appear (`wait_for`), wait for something to go away (`wait_for` +
 * `wait_absent` — a spinner, "Installing…"), or just wait for it to settle down
 * (neither — the pre-existing quiet check, now with a real timeout behind it).
 *
 * A timeout is NOT an error: "it never showed up within 15s" is a legitimate,
 * often expected answer (the build IS still running). It returns the screen with
 * an explicit verdict, because the failure that matters here is the agent reading
 * a timed-out screen as though the condition held.
 */
export async function waitForScreen(
  deps: TerminalToolDeps,
  input: {
    terminalId: string
    wait_for?: string
    wait_absent?: boolean
    wait_timeout_ms?: number
  },
  signal?: AbortSignal,
): Promise<TerminalActionResult> {
  const timeoutMs = Math.min(input.wait_timeout_ms ?? DEFAULT_WAIT_MS, MAX_WAIT_MS)
  const needle = input.wait_for
  const absent = Boolean(input.wait_absent)
  if (absent && !needle) {
    return {
      content: 'wait_absent requires wait_for — say WHAT should disappear.',
      isError: true,
    }
  }

  const start = Date.now()
  const hardDeadline = start + timeoutMs
  // Subscribed BEFORE the first render, so output landing between that render and the
  // subscription still wakes the wait.
  const activity = watchTerminalActivity(deps.watch, input.terminalId, signal)
  let last: ScreenSnapshot | null
  let outcome: WaitOutcome = 'timeout'
  let hasFinalScreen = false
  try {
    last = await deps.screen(input.terminalId)
    if (!last) {
      return {
        content: `No open terminal ${input.terminalId} (it may have exited).`,
        isError: true,
      }
    }

    const satisfied = (text: string): boolean => {
      if (!needle) return false // handled by the quiet path below
      return absent ? !text.includes(needle) : text.includes(needle)
    }

    // Check BEFORE waiting: the condition may already hold, and a wait that sleeps
    // anyway would charge the agent latency for an answer it already had.
    if (needle && satisfied(last.text)) {
      outcome = absent ? 'vanished' : 'matched'
    } else {
      let prev = last.text
      for (;;) {
        // With no needle, "quiet" is QUIET_MS without output, so the window restarts per wake.
        const quietAt = needle ? hardDeadline : Math.min(hardDeadline, Date.now() + QUIET_MS)
        const wake = await activity.next(quietAt)
        if (wake === 'aborted') {
          outcome = 'interrupted'
          break // Esc/Stop pressed — bail with what we have
        }
        if (wake === 'deadline') {
          outcome = quietAt < hardDeadline ? 'quiet' : 'timeout'
          break
        }
        const snap = await deps.screen(input.terminalId)
        if (!snap || wake === 'exit') {
          // A short command can print its answer and exit before this render reads it.
          // The live registry is intentionally cleared on exit, so consult its bounded
          // final-screen archive before deciding the text never appeared.
          const final = snap ?? (await deps.finalScreen?.(input.terminalId)) ?? null
          if (final) {
            last = final
            hasFinalScreen = true
          }
          // The program ended. That is an ANSWER (the command finished), not a failure —
          // the agent asked to wait for something and the wait resolved.
          outcome =
            final && needle && satisfied(final.text) ? (absent ? 'vanished' : 'matched') : 'exited'
          break
        }
        last = snap
        if (needle) {
          if (satisfied(snap.text)) {
            outcome = absent ? 'vanished' : 'matched'
            break
          }
        } else if (snap.text === prev) {
          outcome = 'quiet' // output that redrew nothing
          break
        }
        prev = snap.text
      }
    }
  } finally {
    activity.close()
  }

  const waited = `${Math.round((Date.now() - start) / 100) / 10}s`
  const verdict = ((): string => {
    switch (outcome) {
      case 'matched':
        return `"${needle}" appeared after ${waited}.`
      case 'vanished':
        return `"${needle}" is gone after ${waited}.`
      case 'quiet':
        return `Output went quiet after ${waited}.`
      case 'exited':
        return `The program exited after ${waited} — the terminal is closed.`
      case 'interrupted':
        return `INTERRUPTED after ${waited}: the terminal wait was cancelled. The terminal is still open.`
      case 'timeout':
        return needle
          ? `TIMED OUT after ${waited}: "${needle}" ${absent ? 'is STILL on screen' : 'never appeared'}. ` +
              'This is not necessarily a failure — the program may still be working. Wait again with a ' +
              'longer wait_timeout_ms, or read the screen below to see where it actually is.'
          : `TIMED OUT after ${waited}: the output never went quiet — it is still producing.`
    }
  })()

  if (outcome === 'exited' && !hasFinalScreen) {
    return {
      content: verdict,
      details: { action: 'wait', terminalId: input.terminalId },
    }
  }
  return {
    content: `${verdict}\n${renderScreen(last)}`,
    details: { action: 'wait', terminalId: input.terminalId, screen: last },
    supersedeKey: `terminal:${input.terminalId}`,
  }
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

  const settleScreen = async (
    terminalId: string,
    opts: { maxMs: number; needNonEmpty?: boolean },
  ): Promise<ScreenSnapshot | null> => {
    const capAt = Date.now() + opts.maxMs
    const activity = watchTerminalActivity(deps.watch, terminalId, signal)
    const blank = (s: ScreenSnapshot | null) => Boolean(opts.needNonEmpty) && !s?.text.trim()
    try {
      let last = await deps.screen(terminalId)
      let prev = last?.text ?? null
      for (;;) {
        // A blank screen that must fill keeps waiting for output up to the cap; otherwise
        // QUIET_MS without output is settled.
        const quietAt = blank(last) ? capAt : Math.min(capAt, Date.now() + QUIET_MS)
        const wake = await activity.next(quietAt)
        if (wake === 'aborted' || wake === 'deadline') return last // Stop pressed / quiet / cap
        const snap = await deps.screen(terminalId)
        if (!snap) return null // terminal exited / unknown id
        last = snap
        if (wake === 'exit') return snap
        if (snap.text === prev && !blank(snap)) return snap // output that redrew nothing
        prev = snap.text
      }
    } finally {
      activity.close()
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
    const screen = await settleScreen(terminalId, {
      maxMs: 3000,
      needNonEmpty: true,
    })
    return {
      content: `Opened terminal ${terminalId} running \`${input.command}\`.\n${renderScreen(screen)}`,
      details: { action, terminalId, command: input.command, screen },
      supersedeKey: `terminal:${terminalId}`,
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

  if (action === 'screen') {
    const screen = await settleScreen(terminalId, { maxMs: 800 })
    if (!screen)
      return {
        content: `No open terminal ${terminalId} (it may have exited).`,
        isError: true,
      }
    return {
      content: renderScreen(screen),
      details: { action, terminalId, screen },
      supersedeKey: `terminal:${terminalId}`,
    }
  }

  if (action === 'wait') {
    const label = waitLabel(input)
    deps.onWait?.({ terminalId, active: true, label })
    try {
      return await waitForScreen(deps, { terminalId, ...input }, signal)
    } finally {
      deps.onWait?.({ terminalId, active: false, label })
    }
  }

  // keys / type: write bytes, settle, return the fresh screen. action="type"
  // may also carry `keys`, pressed AFTER the text (e.g. type "ls" then Enter in
  // ONE call); action="keys" is keys-only.
  let data: string
  let trailingKeys: string | undefined
  let sentLabel: string
  if (action === 'keys') {
    if (!input.keys?.length)
      return { content: 'keys is required for action="keys".', isError: true }
    data = encodeKeys(input.keys)
    // The result is persisted in the tool transcript. Keep it privacy-safe for
    // the same reason as `terminal.input`: `keys` can contain credentials or
    // answers to an interactive prompt, so never echo literal key payloads.
    sentLabel = inputLabel({ action, keys: input.keys })
  } else {
    if (input.text == null) return { content: 'text is required for action="type".', isError: true }
    data = input.text
    trailingKeys = input.keys?.length ? encodeKeys(input.keys) : undefined
    sentLabel = input.keys?.length ? `text + ${input.keys.join(' ')}` : 'text'
  }
  const ok = deps.write(terminalId, data)
  if (!ok)
    return {
      content: `No open terminal ${terminalId} (it may have exited).`,
      isError: true,
    }
  if (trailingKeys) {
    // Written as a SEPARATE write after a short settle, not concatenated onto the
    // text: some TUI composers (e.g. Codex) detect paste-vs-typing by input burst
    // speed, and a trailing Enter glued onto the same fast write can be swallowed
    // as a newline inside the pasted text instead of registering as submit.
    await sleep(50)
    deps.write(terminalId, trailingKeys)
  }
  deps.onInput?.({
    terminalId,
    label: inputLabel({ action, keys: input.keys }),
  })
  const screen = await settleScreen(terminalId, { maxMs: 1500 })
  return {
    content: `Sent ${sentLabel} to terminal ${terminalId}.\n${renderScreen(screen)}`,
    details: { action, terminalId, screen },
    supersedeKey: `terminal:${terminalId}`,
  }
}
