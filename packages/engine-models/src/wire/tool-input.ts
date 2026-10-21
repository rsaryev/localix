/**
 * A TOOL CALL'S INPUT AS IT STREAMS: the raw JSON so far, and the arguments it stands for, so a
 * card can show a file's content while the model is still writing it.
 *
 * Each parse reads the whole input, so parsing on every delta makes a long `write` quadratic.
 * The input is parsed again once it has grown by a quarter (geometric growth keeps the total
 * linear) or once a moment has passed with something new (the card stays live); the moment
 * stretches with the input, so a megabyte-long one is not reparsed ten times a second. The input
 * that ends the call is parsed in full.
 */
import { parseJsonLenient, parsePartialJson } from './partial-json'

const REPARSE_GROWTH = 1.25
const REPARSE_INTERVAL_MS = 100
const REPARSE_MS_PER_CHAR = 1 / 4_000

export class StreamingToolInput {
  private text = ''
  private parsedLength = 0
  private parsedAt = 0
  /** The arguments as far as they last parsed: a half-written literal never blanks them. */
  arguments: unknown = {}

  /** Add a delta; the arguments are reparsed when it is due. */
  push(delta: string, now: number): unknown {
    this.text += delta
    if (this.due(now)) {
      this.parsedLength = this.text.length
      this.parsedAt = now
      this.arguments = parsePartialJson(this.text) ?? this.arguments
    }
    return this.arguments
  }

  private due(now: number): boolean {
    const length = this.text.length
    if (length <= this.parsedLength) return false
    if (this.parsedLength === 0 || length >= this.parsedLength * REPARSE_GROWTH) return true
    const interval = Math.max(REPARSE_INTERVAL_MS, length * REPARSE_MS_PER_CHAR)
    return now - this.parsedAt >= interval
  }
}

/**
 * The arguments of a finished call. A model's slightly broken JSON (`\d` in a regex, a raw
 * newline) is repaired; one cut off short keeps what parses.
 */
export function parseToolInput(input: unknown): unknown {
  if (typeof input !== 'string') return input ?? {}
  if (!input.trim()) return {}
  try {
    return parseJsonLenient(input)
  } catch {
    return parsePartialJson(input) ?? {}
  }
}
