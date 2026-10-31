import { commandWaitMs, type VfCommand } from '@localixai/visual-feedback/protocol'

/** How long a page gets to answer one command, before a wait step's own time is added. */
const BASE_MS = 10_000

/** The native bridge is asked for an answer every this many ms. */
export const NATIVE_POLL_MS = 25

/**
 * The window a probe has to answer a command: ten seconds, plus what the command's `wait` steps
 * may spend polling in the page. Without the second part a 15 s wait is abandoned at 10 s while
 * it is still doing exactly what it was asked to.
 */
export function commandWindow(command: unknown): {
  ms: number
  attempts: number
} {
  const ms = BASE_MS + commandWaitMs(command as Pick<VfCommand, 'steps'>)
  return { ms, attempts: Math.ceil(ms / NATIVE_POLL_MS) }
}
