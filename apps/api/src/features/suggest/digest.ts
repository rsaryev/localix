/**
 * The chat composer's own grounding for inline completion: a compact, bounded digest of the
 * session's last few turns. Linked chips and open tabs are NOT rendered here — they are the shared
 * working set, resolved through Context Fabric for every surface (`surface-context.ts`).
 */

/** A trimmed conversation turn — role + plain text only. */
export interface SuggestDigestTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface SuggestSessionContext {
  /** Recent turns, oldest→newest; only the tail is used. */
  turns: SuggestDigestTurn[]
}

/** Only the last few turns feed the model — the digest must stay bounded. */
export const MAX_DIGEST_TURNS = 4
/** Per-turn UTF-8 byte cap after whitespace collapse. */
export const PER_TURN_BYTES = 320
/**
 * The LAST turn's cap, kept from its END. With an empty composer the prediction is the person's
 * reply to that turn, and a reply answers how a message ends — the question it closes on, the
 * options it offers — which the head-clip of every other turn cut off: "Want me to walk through
 * the exercises?" was the part that never reached the model.
 */
export const LAST_TURN_TAIL_BYTES = 900

/** Collapse whitespace to one line and clip without splitting a Unicode code point. */
export function clip(text: string, maxBytes: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (Buffer.byteLength(t, 'utf8') <= maxBytes) return t
  const marker = '…'
  const markerBytes = Buffer.byteLength(marker, 'utf8')
  if (maxBytes <= markerBytes) return ''
  let used = 0
  const kept: string[] = []
  for (const point of Array.from(t)) {
    const bytes = Buffer.byteLength(point, 'utf8')
    if (used + bytes > maxBytes - markerBytes) break
    kept.push(point)
    used += bytes
  }
  return `${kept.join('').trimEnd()}${marker}`
}

/** `clip` from the other end: keep the last `maxBytes`, marked where the head was cut. */
export function clipTail(text: string, maxBytes: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (Buffer.byteLength(t, 'utf8') <= maxBytes) return t
  const marker = '…'
  const markerBytes = Buffer.byteLength(marker, 'utf8')
  if (maxBytes <= markerBytes) return ''
  let used = 0
  const kept: string[] = []
  const points = Array.from(t)
  for (let i = points.length - 1; i >= 0; i--) {
    const bytes = Buffer.byteLength(points[i]!, 'utf8')
    if (used + bytes > maxBytes - markerBytes) break
    kept.push(points[i]!)
    used += bytes
  }
  return `${marker}${kept.reverse().join('').trimStart()}`
}

/**
 * Render the session-context block, or `''` when the session has nothing to anchor on yet
 * (no turns) — the surface then decides whether its draft alone is enough.
 */
export function renderSessionDigest(ctx: SuggestSessionContext): string {
  const lines: string[] = []
  const recent = ctx.turns.filter((t) => t.text.trim()).slice(-MAX_DIGEST_TURNS)
  if (recent.length > 0) {
    lines.push('Recent conversation between the user and their coding agent:')
    recent.forEach((t, index) => {
      const last = index === recent.length - 1
      const text = last ? clipTail(t.text, LAST_TURN_TAIL_BYTES) : clip(t.text, PER_TURN_BYTES)
      lines.push(`${t.role === 'user' ? 'User' : 'Assistant'}: ${text}`)
    })
  }
  return lines.join('\n')
}
