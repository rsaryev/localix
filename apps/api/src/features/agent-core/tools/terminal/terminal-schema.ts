import { z } from 'zod'
export const INTERACTIVE_ACTIONS = [
  'open',
  'screen',
  'keys',
  'type',
  'wait',
  'list',
  'close',
] as const

/**
 * Bounds for action="wait". The default is generous enough for the cases that
 * drove this (a dev server compiling, an installer, a REPL warming up) without a
 * typo'd `wait_for` parking the agent for minutes; the max is the hard ceiling on
 * how long ONE tool call may block a turn.
 */
export const DEFAULT_WAIT_MS = 15_000
export const MAX_WAIT_MS = 120_000

/** Zod fields the `bash` schema merges in to expose the interactive actions. */
export const terminalActionFields = {
  action: z
    .enum(INTERACTIVE_ACTIONS)
    .optional()
    .describe(
      'Omit for shell commands. PTY: open starts; screen reads full viewport; type sends text + keys; keys navigates; wait observes; list/close. Input returns a screen: avoid redundant reads, batch known keys, verify before branching.',
    ),
  terminal_id: z.string().optional().describe('From open/list; required except for open/list.'),
  keys: z
    .array(z.string())
    .optional()
    .describe(
      'Ordered named keys (Enter, Escape, Down, Ctrl+C…) or text; after type text. Submit with ["Enter"], not a newline.',
    ),
  text: z
    .string()
    .optional()
    .describe('type: literal text; keys:["Enter"] submits it in this call.'),
  wait_for: z
    .string()
    .optional()
    .describe(
      'Literal, case-sensitive screen text to await; combine with open/type/keys. Match response/status, not echoed input. Omit for quiet output; quiet does not prove completion.',
    ),
  wait_absent: z.boolean().optional().describe('Await disappearance of wait_for instead.'),
  wait_for_exit: z
    .boolean()
    .optional()
    .describe(
      'Wait for process exit in this call, including after input. Excludes wait_for/absent.',
    ),
  wait_timeout_ms: z
    .number()
    .int()
    .min(100)
    .max(MAX_WAIT_MS)
    .optional()
    .describe(`Wait cap in ms (default ${DEFAULT_WAIT_MS}, max ${MAX_WAIT_MS}).`),
}
