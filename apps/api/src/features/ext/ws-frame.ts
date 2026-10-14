/**
 * The SINGLE owner of the multiplexed `/rpc/ws` wire-frame envelope.
 *
 * This module is the parsing counterpart of the framing PRODUCERS that live beside
 * it: `realtime/ws.ts` writes the `s\n` / `r\n` / `n\n` frames, and
 * `ws-frame-registry.ts` writes `<frameTag>\n<data>` for every subsystem-contributed
 * live stream. Producer and parser sit in one directory ON PURPOSE — the envelope is
 * ONE piece of system knowledge, so a change to the framing is a change to one place
 * and every client derives from it.
 *
 * The client side IMPORTS this leaf rather than restating it: `@localixai/api/ws-frame`
 * → `apps/ui/src/shared/api/frameParser.ts`. There is one client today; there were two,
 * they were hand-copied twins, and they silently drifted — the second copy never learned
 * the generic `frame` kind and its own test asserted the gap was correct. Do not re-copy
 * this file — import it.
 *
 * Frame kinds:
 *   session: "s\n<boot-epoch>:<sequence>\n<sessionId>\n<event-json>"
 *   rpc:     "r\n<response-json>"
 *   journal: "n\n<inbox-change-json>" — the notification journal, sent by core
 *            (`realtime/ws.ts`) and parsed here as a generic tagged frame
 *   frame:   "<tag>\n<payload-json>" — a GENERIC subsystem live-stream frame. The
 *            single-char `tag` (any leading char other than the reserved s/r/n —
 *            `RESERVED_FRAME_TAGS` in the plugin SDK refuses them at registration) is
 *            contributed by a backend subsystem via `WsFrameContribution.frameTag`
 *            and demuxed by a registered per-tag handler. Core names no subsystem.
 *
 * It only splits the newline-delimited envelope and leaves payload `JSON.parse` to
 * the caller — so the bug-prone offset arithmetic is unit-testable in isolation and
 * this module stays dependency-free (no Node/DOM/Hono imports: a browser and Bun must
 * both be able to load it).
 *
 * Event JSON never contains a raw newline (JSON.stringify escapes them), so
 * the first three `indexOf('\n')` splits are safe.
 */

/** Leading chars reserved by core; every other tag is a contributed generic frame. */
const SESSION_FRAME = 115 /* 's' */
const RPC_FRAME = 114 /* 'r' */

export interface SessionCursor {
  epoch: string
  sequence: string
}

/** Encode the one supported session cursor format. */
export function encodeSessionCursor(epoch: string, sequence: string): string {
  return `${epoch}:${sequence}`
}

/** Parse the one supported session cursor format; bare numeric ids are invalid. */
export function parseSessionCursor(value: string): SessionCursor | null {
  const match = /^([^:\r\n]+):([0-9]+)$/.exec(value)
  return match ? { epoch: match[1]!, sequence: match[2]! } : null
}

function isDecimalNewer(candidate: string, cursor: string): boolean {
  const next = candidate.replace(/^0+(?=\d)/, '')
  const previous = cursor.replace(/^0+(?=\d)/, '')
  if (next.length !== previous.length) return next.length > previous.length
  return next > previous
}

/** Compare strict session cursors without losing large sequence precision. */
export function isSessionCursorNewer(candidate: string, cursor: string | null): boolean {
  const next = parseSessionCursor(candidate)
  if (!next) return false
  if (cursor === null) return true
  const previous = parseSessionCursor(cursor)
  if (!previous) return false
  if (next.epoch !== previous.epoch) return true
  return isDecimalNewer(next.sequence, previous.sequence)
}

export type ParsedFrame =
  | { kind: 'session'; cursor: string; sessionId: string; json: string }
  | { kind: 'rpc'; json: string }
  | { kind: 'frame'; tag: string; json: string }

export function parseFrame(raw: string): ParsedFrame | null {
  const kind = raw.charCodeAt(0)

  if (kind === SESSION_FRAME) {
    const p1 = raw.indexOf('\n')
    const p2 = p1 === -1 ? -1 : raw.indexOf('\n', p1 + 1)
    const p3 = p2 === -1 ? -1 : raw.indexOf('\n', p2 + 1)
    // All three delimiters must be present — otherwise a truncated frame like
    // "s\nboot-a:42" would let p3 re-find an earlier newline and yield a garbage split.
    if (p1 === -1 || p2 === -1 || p3 === -1) return null
    const cursor = raw.slice(p1 + 1, p2)
    if (!parseSessionCursor(cursor)) return null
    return {
      kind: 'session',
      cursor,
      sessionId: raw.slice(p2 + 1, p3),
      json: raw.slice(p3 + 1),
    }
  }

  if (kind === RPC_FRAME) {
    const nl = raw.indexOf('\n')
    return nl === -1 ? null : { kind: 'rpc', json: raw.slice(nl + 1) }
  }

  // Any other single-char leading tag is a generic subsystem live-stream frame
  // (`ws-frame-registry.ts` emits `<frameTag>\n<data>`).
  const nl = raw.indexOf('\n')
  if (nl !== 1) return null // tag must be exactly one char followed by '\n'
  return { kind: 'frame', tag: raw.slice(0, 1), json: raw.slice(nl + 1) }
}
