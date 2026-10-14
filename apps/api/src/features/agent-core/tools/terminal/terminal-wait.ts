import type { TerminalToolDeps, TerminalActionResult } from './terminal'
import type { ScreenSnapshot } from './terminal-job'
import { watchTerminalActivity } from './terminal-activity'
import { DEFAULT_WAIT_MS, MAX_WAIT_MS } from './terminal-schema'
import { QUIET_MS, renderScreen } from './terminal-screen'

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
    wait_for_exit?: boolean
    wait_timeout_ms?: number
    fullScreen?: boolean
  },
  signal?: AbortSignal,
): Promise<TerminalActionResult> {
  const timeoutMs = Math.min(input.wait_timeout_ms ?? DEFAULT_WAIT_MS, MAX_WAIT_MS)
  const needle = input.wait_for
  const absent = Boolean(input.wait_absent)
  const waitForExit = Boolean(input.wait_for_exit)
  if (waitForExit && (needle !== undefined || absent)) {
    return { content: 'wait_for_exit cannot be combined with wait_for/wait_absent.', isError: true }
  }
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
  let exited = false
  try {
    last = await deps.screen(input.terminalId)
    if (!last) {
      last = (await deps.finalScreen?.(input.terminalId)) ?? null
      hasFinalScreen = Boolean(last)
      exited = true
    }
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
    if (signal?.aborted) {
      outcome = 'interrupted'
    } else if (needle && satisfied(last.text)) {
      outcome = absent ? 'vanished' : 'matched'
    } else if (exited) {
      outcome = 'exited'
    } else {
      for (;;) {
        // With no needle, "quiet" is QUIET_MS without output, so the window restarts per wake.
        const quietAt =
          needle || waitForExit ? hardDeadline : Math.min(hardDeadline, Date.now() + QUIET_MS)
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
          exited = true
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
        }
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
        return `INTERRUPTED after ${waited}: the terminal wait was cancelled.${exited ? ' The terminal has exited.' : ' The terminal is still open.'}`
      case 'timeout':
        if (waitForExit) return `TIMED OUT after ${waited}: the program is still running.`
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
      details: {
        action: 'wait',
        terminalId: input.terminalId,
        state: 'exited',
        waitOutcome: outcome,
      },
      supersedeKey: `terminal:${input.terminalId}`,
    }
  }
  return {
    content: `${verdict}\nTerminal ${input.terminalId}: ${exited ? 'exited' : 'running'}.\n${renderScreen(last, { compact: !input.fullScreen, waitFor: needle })}`,
    details: {
      action: 'wait',
      terminalId: input.terminalId,
      screen: last,
      state: exited ? 'exited' : 'running',
      waitOutcome: outcome,
    },
    supersedeKey: `terminal:${input.terminalId}`,
  }
}
