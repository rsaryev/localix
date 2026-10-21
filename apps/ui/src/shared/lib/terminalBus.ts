/**
 * One-way channel for sending a command into a chat's terminal, mirroring `inspectorBus`
 * (chat/code-block → shared ← terminal). A shell code block in the transcript calls
 * `terminal.run({ sessionId, command })`; the terminal feature registers the opener (so that
 * chat's terminal tab opens if closed) and each active pane registers its input sender under its
 * own chat. A command that arrives before that chat's pane is connected is held for that chat and
 * flushed the moment its active pane is ready.
 *
 * Keyed by chat on purpose: one app-wide "last active pane" sender pasted a command from chat A's
 * transcript into whichever terminal had registered last — chat B's shell, in chat B's directory.
 *
 * Commands are PASTED (no trailing newline) — the user reviews on the prompt and
 * presses Enter, so nothing auto-executes.
 */

type Sender = (data: string) => void
/** Reveal the terminal tab and attach a pane to an agent-launched job by backend terminal id. */
type JobOpener = (args: { terminalId: string; sessionId: string; title?: string }) => void

/** How a backend terminal ended, as the `terminal.finished` frame reports it. */
export interface TerminalExit {
  exitCode: number | null
  interactive?: boolean
  command?: string
  cwd?: string
}
/** Retire a finished terminal's tabs and transcript actions. */
type Finisher = (terminalId: string, exit: TerminalExit) => void
/** Reveal the pane of a terminal a chat owns (an external agent's CLI). */
type OwnedOpener = (sessionId: string, terminalId: string, title: string) => void

let opener: ((sessionId: string) => void) | null = null
const senders = new Map<string, Sender>()
const pending = new Map<string, string>()
let jobOpener: JobOpener | null = null
let finisher: Finisher | null = null
let ownedOpener: OwnedOpener | null = null

export const terminal = {
  /** The terminal feature registers how to reveal a chat's terminal tab. */
  setOpener(fn: (sessionId: string) => void): () => void {
    opener = fn
    return () => {
      if (opener === fn) opener = null
    }
  },

  /** A chat's active, connected pane registers its stdin writer; flushes that chat's pending. */
  setActiveSender(sessionId: string, fn: Sender): () => void {
    senders.set(sessionId, fn)
    const queued = pending.get(sessionId)
    if (queued !== undefined) {
      pending.delete(sessionId)
      fn(queued)
    }
    return () => {
      if (senders.get(sessionId) === fn) senders.delete(sessionId)
    }
  },

  /** Send a command to a chat's terminal — opening it and queuing if not yet connected. */
  run(args: { sessionId: string; command: string }): void {
    // Enforce the paste-don't-execute contract centrally: strip a trailing
    // newline so the command lands on the prompt for review regardless of how
    // the caller formatted it (a code block vs a command card's raw string).
    const text = args.command.replace(/\n+$/, '')
    opener?.(args.sessionId)
    const send = senders.get(args.sessionId)
    if (send) send(text)
    else pending.set(args.sessionId, text)
  },

  /** The terminal feature registers how to reveal + attach an agent job pane. */
  setJobOpener(fn: JobOpener): () => void {
    jobOpener = fn
    return () => {
      if (jobOpener === fn) jobOpener = null
    }
  },

  /** Reveal a chat's terminal tab attached to an agent-launched job (by backend terminal id). */
  openJob(args: Parameters<JobOpener>[0]): void {
    jobOpener?.(args)
  },

  /** The terminal feature registers how to reveal a terminal a chat owns. */
  setOwnedOpener(fn: OwnedOpener): () => void {
    ownedOpener = fn
    return () => {
      if (ownedOpener === fn) ownedOpener = null
    }
  },

  /** Reveal the pane of a chat-owned terminal. No-op until the terminal feature is wired. */
  openOwned(sessionId: string, terminalId: string, title: string): void {
    ownedOpener?.(sessionId, terminalId, title)
  },

  /** The terminal feature registers how a finished terminal retires its tabs; the app installs it. */
  setFinisher(fn: Finisher): () => void {
    finisher = fn
    return () => {
      if (finisher === fn) finisher = null
    }
  },

  /** A backend terminal exited: hand it to the terminal feature. No-op until one is installed. */
  finished(terminalId: string, exit: TerminalExit): void {
    finisher?.(terminalId, exit)
  },
}
