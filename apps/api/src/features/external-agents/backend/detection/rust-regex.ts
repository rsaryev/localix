/**
 * Translate the Rust `regex`-crate syntax used by the manifests into a JavaScript `RegExp`.
 *
 * Three concrete incompatibilities, each of which silently produces the WRONG answer rather than
 * an error if ignored — which is why this is its own tested module and not an inline `new RegExp`:
 *
 *  1. INLINE FLAGS. Rust writes `(?i)^\s*❯?\s*yes\b` and `(?m)^\s*❯\s*$`. JavaScript has no inline
 *     flag groups. `new RegExp('(?i)foo')` does not throw — it parses `(?i)` as a *group*, so the
 *     pattern quietly stops matching what it was meant to match. Leading flag groups are stripped
 *     and hoisted onto the RegExp flags instead.
 *  2. UNICODE ESCAPES. Rust writes `\x{2800}`; JavaScript spells that `\u{2800}` and only accepts
 *     it under the `u` flag. Left alone, `\x{2800}` means a literal `x` repeated 2800 times in a
 *     non-unicode regex — a matcher that can never fire.
 *  3. The `u` flag then makes previously tolerated escapes throw, so it is applied only when the
 *     pattern actually needs it.
 *
 * Anything that still fails to compile returns `null`; the caller drops that matcher and records
 * it, rather than crashing state detection for one bad rule.
 */

const LEADING_FLAGS = /^\(\?([imsux]+)\)/

export function translateRustRegex(pattern: string): RegExp | null {
  let body = pattern
  const flags = new Set<string>()

  // Rust allows several stacked leading groups: `(?i)(?m)…`
  for (;;) {
    const match = LEADING_FLAGS.exec(body)
    if (!match) break
    for (const flag of match[1]) {
      // `x` (extended/whitespace-insensitive) and `s` map differently; `s` exists in JS, `x` does not.
      if (flag === 'x') continue
      flags.add(flag)
    }
    body = body.slice(match[0].length)
  }

  const needsUnicode = /\\x\{[0-9a-fA-F]+\}|\\u\{[0-9a-fA-F]+\}/.test(body)
  if (needsUnicode) {
    body = body.replace(/\\x\{([0-9a-fA-F]+)\}/g, '\\u{$1}')
    flags.add('u')
  }

  try {
    return new RegExp(body, [...flags].join(''))
  } catch {
    return null
  }
}
