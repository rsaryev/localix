/**
 * Keywords after which a `/` begins a REGEX LITERAL, not a division.
 *
 * Without them, `return /foo/.test(x)` reads as division, the scanner never enters the
 * regex, and a `//` inside it (`/https?:\/\//`) is mistaken for a line comment — which
 * would silently truncate the rest of that line from every scan.
 */
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'do',
  'else',
  'case',
  'yield',
  'await',
  'throw',
])

/** May a `/` at the end of `emitted` start a regex literal (vs. be a division)? */
function regexMayStart(emitted: string): boolean {
  let i = emitted.length - 1
  while (i >= 0 && /\s/.test(emitted[i] as string)) i--
  if (i < 0) return true // start of file

  const ch = emitted[i] as string
  // A value just ended: `)` `]` `'x'` `"x"` `` `x` `` `1` `ident` → the `/` divides it.
  if (ch === ')' || ch === ']' || ch === "'" || ch === '"' || ch === '`') return false
  if (/[\w$]/.test(ch)) {
    let j = i
    while (j >= 0 && /[\w$]/.test(emitted[j] as string)) j--
    const word = emitted.slice(j + 1, i + 1)
    if (/^\d/.test(word)) return false // numeric literal → division
    return REGEX_PRECEDING_KEYWORDS.has(word)
  }
  // `(` `,` `=` `:` `[` `{` `;` `!` `&` `|` `?` `+` `-` `*` `%` `~` `^` `<` `>` `}` …
  return true
}

/** Index just past the closing `quote`. An unterminated literal stops at the newline. */
function scanQuoted(src: string, start: number, quote: string): number {
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i] as string
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === quote) return i + 1
    if (ch === '\n') return i // unterminated — do not swallow the rest of the file
  }
  return src.length
}

/**
 * Index just past a regex literal's closing `/` + flags, or `-1` when this `/` cannot be
 * one (a regex literal may not span a line). Char classes are tracked, because `/[/]/` is
 * legal and its inner `/` does not close the literal.
 */
function scanRegexLiteral(src: string, start: number): number {
  let inClass = false
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i] as string
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === '\n') return -1
    if (inClass) {
      if (ch === ']') inClass = false
      continue
    }
    if (ch === '[') {
      inClass = true
      continue
    }
    if (ch === '/') {
      let j = i + 1
      while (j < src.length && /[a-z]/i.test(src[j] as string)) j++
      return j
    }
  }
  return -1
}

/**
 * Remove `//` line comments and `/* … *\/` block comments from TypeScript source — and
 * NOTHING ELSE.
 *
 * Three properties every caller depends on, and which the nine hand-rolled copies this
 * replaced did not all have:
 *
 *  - A `//` inside a STRING (`'https://x'`), a TEMPLATE (`` `${a}//${b}` ``), or a REGEX
 *    (`/https?:\/\//`) is not a comment. A stripper that eats it truncates real code out of
 *    the scan — the same silent blindness, arriving from the other direction.
 *  - A TRAILING comment is a comment: `const x = 1 // process.env.FOO` must not leave
 *    `process.env.FOO` visible. The common line-based copy kept it.
 *  - LINE NUMBERS SURVIVE. Newlines inside a block comment are re-emitted, so a detector
 *    can still report the line it matched (`composition-root-contract` does).
 */
export function stripComments(src: string): string {
  let out = ''
  // Context stack. `code` is ordinary source — INCLUDING the inside of a `${…}`
  // substitution, where comments are legal again. `template` is a template literal's text,
  // where they are not. `braces` counts `{}` inside a `code` context so the `}` that CLOSES
  // a substitution is told apart from an ordinary block's.
  const stack: { kind: 'code' | 'template'; braces: number }[] = [{ kind: 'code', braces: 0 }]

  let i = 0
  const n = src.length
  while (i < n) {
    const ctx = stack[stack.length - 1] as { kind: 'code' | 'template'; braces: number }
    const ch = src[i] as string

    if (ctx.kind === 'template') {
      if (ch === '\\') {
        out += src.slice(i, i + 2)
        i += 2
      } else if (ch === '`') {
        stack.pop()
        out += ch
        i++
      } else if (ch === '$' && src[i + 1] === '{') {
        stack.push({ kind: 'code', braces: 0 })
        out += '${'
        i += 2
      } else {
        out += ch
        i++
      }
      continue
    }

    // ── code ──
    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++ // the newline itself is left to be emitted
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n' // keep the line count intact
        i++
      }
      i += 2
      continue
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuoted(src, i, ch)
      out += src.slice(i, end)
      i = end
      continue
    }
    if (ch === '`') {
      stack.push({ kind: 'template', braces: 0 })
      out += ch
      i++
      continue
    }
    if (ch === '/' && regexMayStart(out)) {
      const end = scanRegexLiteral(src, i)
      if (end > 0) {
        out += src.slice(i, end)
        i = end
        continue
      }
      // Not a regex after all — fall through and emit the `/` as an ordinary character.
    }
    if (ch === '{') {
      ctx.braces++
    } else if (ch === '}') {
      if (ctx.braces === 0 && stack.length > 1) {
        stack.pop() // this `}` closes a `${…}` substitution
        out += ch
        i++
        continue
      }
      ctx.braces--
    }
    out += ch
    i++
  }
  return out
}
