import { z } from 'zod'

export const MAX_TERMINAL_INPUT_BYTES = 64 * 1024
const MAX_TERMINAL_COMMAND_BYTES = 64 * 1024
const MAX_TERMINAL_CLIENT_FRAME_BYTES = MAX_TERMINAL_INPUT_BYTES + 256
const utf8 = new TextEncoder()
const withinBytes = (value: string, max: number): boolean => utf8.encode(value).byteLength <= max

/**
 * Create an interactive terminal for a chat session's workspace.
 *
 * `sessionId` is REQUIRED. Without one the pane used to open in $HOME bound to no session:
 * nothing confined it to a workspace, no session's work strip listed it, and deleting a chat
 * never closed it. Every terminal now belongs to the session that opened it, and its cwd is
 * that session's (after the ownership check).
 */
export const createTerminalRequestSchema = z.object({
  sessionId: z.string().min(1).max(256),
  cols: z.number().int().positive().max(1000).optional(),
  rows: z.number().int().positive().max(1000).optional(),
})
export type CreateTerminalRequest = z.infer<typeof createTerminalRequestSchema>

/** Run a one-shot command in a PTY pane for a chat session's workspace (UI-driven,
 *  e.g. the preview panel relaunching a stopped dev server). `sessionId` is required for the
 *  reason given above: an unbound command ran in $HOME and was nobody's background work. */
export const spawnTerminalRequestSchema = z.object({
  sessionId: z.string().min(1).max(256),
  command: z
    .string()
    .min(1)
    .refine((value) => withinBytes(value, MAX_TERMINAL_COMMAND_BYTES), 'Command is too large'),
  cols: z.number().int().positive().max(1000).optional(),
  rows: z.number().int().positive().max(1000).optional(),
})
export type SpawnTerminalRequest = z.infer<typeof spawnTerminalRequestSchema>

/** A live terminal session descriptor returned to the client. */
export interface TerminalInfo {
  id: string
  cwd: string
  createdAt: number
}

/** Client→server frames over the terminal WebSocket. The socket is an untrusted
 * transport, so this schema (not a TypeScript cast) is the runtime boundary. */
export const terminalClientFrameSchema = z.discriminatedUnion('t', [
  z
    .object({
      t: z.literal('input'),
      data: z
        .string()
        .refine((value) => withinBytes(value, MAX_TERMINAL_INPUT_BYTES), 'Input is too large'),
    })
    .strict(),
  z
    .object({
      t: z.literal('resize'),
      cols: z.number().int().positive().max(1000),
      rows: z.number().int().positive().max(1000),
    })
    .strict(),
])
export type TerminalClientFrame = z.infer<typeof terminalClientFrameSchema>

/** Decode the exact untrusted WebSocket payload. Invalid JSON and frames fail
 * closed so the route never invokes the PTY write/resize methods for them. */
export function parseTerminalClientFrame(data: unknown): TerminalClientFrame | null {
  if (typeof data !== 'string') return null
  // This route shares Bun's larger realtime socket cap (large chat bindings are
  // legitimate there). Reject before JSON.parse so a terminal frame cannot make
  // us allocate/parse tens of megabytes merely to fail its inner input schema.
  if (!withinBytes(data, MAX_TERMINAL_CLIENT_FRAME_BYTES)) return null
  let raw: unknown
  try {
    raw = JSON.parse(data)
  } catch {
    return null
  }
  const parsed = terminalClientFrameSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** Server→client frames over the terminal WebSocket. */
export type TerminalServerFrame = { t: 'data'; data: string } | { t: 'exit'; code: number }
