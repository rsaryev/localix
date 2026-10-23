/**
 * Decoding a response's bytes as the server actually encoded them.
 *
 * `readBodyCapped` builds a bare `new TextDecoder()`, which is UTF-8, always. The response's own
 * `charset` was never read, so any server that does not speak UTF-8 came back as replacement
 * characters. Measured:
 *
 *   text/plain; charset=windows-1251   a Cyrillic greeting  → one replacement character per byte
 *   text/plain; charset=ISO-8859-1     "café résumé"  → "caf� r�sum�"
 *   text/plain; charset=Shift_JIS      "こんにちは"     → "����ɂ���"
 *   text/plain; charset=utf-8          a Cyrillic greeting  → the greeting, intact
 *
 * An agent then reads the mojibake and reasons about it — reports an API as broken, or "fixes" an
 * encoding problem that only exists in our reader.
 *
 * AND THE RUNTIME CANNOT DO ALL OF THEM. Bun's `TextDecoder` has the WHATWG Encoding set (up to
 * Bun 1.3 it lacked `windows-1251` and `koi8-r` too), but a label outside it — `utf-7`, or
 * `iso-2022-kr`, which the standard maps to no decoder — is still refused. An unsupported label
 * does not degrade, it THROWS `RangeError`, so passing a charset through unchecked would turn a
 * mojibake body into a failed send.
 *
 * So: decode what we can, and for what we cannot, fall back to UTF-8 and SAY SO. A body we quietly
 * garbled is the failure this mini app keeps finding — plausible, silent, and reasoned about as if
 * it were the server's fault. A body we garbled with a line saying which charset we could not
 * honour is a fact the reader can act on.
 */

/** `text/html; charset=ISO-8859-1` → `iso-8859-1`. Null when the header names none. */
export function charsetOf(contentType: string | null | undefined): string | null {
  if (!contentType) return null
  // `charset=x`, optionally quoted, anywhere among the parameters.
  const match = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType)
  return match ? match[1].toLowerCase() : null
}

/** Can the runtime actually decode this label? Asked by CONSTRUCTING one — the only honest test. */
export function canDecode(label: string): boolean {
  try {
    new TextDecoder(label)
    return true
  } catch {
    return false
  }
}

export interface DecodingPlan {
  /** The label to hand `TextDecoder`. Always one the runtime accepts. */
  label: string
  /** Set when the server named a charset we could not honour — the body may be garbled. */
  problem: string | null
}

/**
 * What to decode with, and whether to warn.
 *
 * No charset named → UTF-8, no warning: that is the correct default for HTTP and the overwhelming
 * majority of APIs. A named charset we support → use it. A named charset we do not → UTF-8, and say
 * which one was asked for, because the alternative is silently handing back nonsense.
 */
export function decodingPlan(contentType: string | null | undefined): DecodingPlan {
  const charset = charsetOf(contentType)
  if (!charset) return { label: 'utf-8', problem: null }
  if (canDecode(charset)) return { label: charset, problem: null }
  return {
    label: 'utf-8',
    problem:
      `The server sent this as \`charset=${charset}\`, which this runtime cannot decode. The body ` +
      "below was read as UTF-8 instead, so any non-ASCII text in it is WRONG — not the server's " +
      'fault, and not worth debugging as an API problem. Ask the endpoint for UTF-8 if it can ' +
      '(many honour `Accept-Charset: utf-8`), or treat the body as bytes.',
  }
}
