/**
 * THE stripper. One implementation, because there was nearly one per lint and they disagreed.
 *
 * A source lint reads a file and asserts a token is (or is not) in it. That makes the READING a
 * thing that can be wrong, and every hand-rolled reader in this repo was wrong the same way: it
 * matched the RAW file text, comments included. So the guarded code could be commented out —
 *
 *     // const target = await run(() => resolveCloseTarget(ex, symbol))
 *
 * — and the lint still found every token it looked for, inside the comment, and reported green with
 * the feature fully disabled. A guard that answers "the code you were watching is gone" by passing
 * is not a weak guard; it is a false one.
 */

/** The set of code characters after which a `/` opens a REGEX rather than dividing. */
const REGEX_MAY_FOLLOW = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '~',
  '^',
  '<',
  '>',
  '\n',
])

/** Keywords after which a `/` opens a regex (`return /x/.test(s)`, `typeof /x/`, `case /x/`). */
const REGEX_MAY_FOLLOW_KEYWORD =
  /\b(?:return|typeof|instanceof|in|of|new|delete|void|do|else|case|yield|await|throw)$/

/**
 * Is the `/` at `i` the start of a regex literal, rather than a division operator?
 *
 * The standard heuristic: look back past whitespace at the last significant character. A regex may
 * only follow an operator, a punctuator, or one of the keywords above — never an identifier, a
 * literal, or a closing `)`/`]` (those end an expression, so `/` divides it).
 */
function opensRegex(src: string, i: number): boolean {
  let j = i - 1
  while (j >= 0 && (src[j] === ' ' || src[j] === '\t')) j--
  if (j < 0) return true
  const prev = src[j] as string
  if (REGEX_MAY_FOLLOW.has(prev)) return true
  // An identifier char: only a keyword may precede a regex.
  if (/[A-Za-z_$]/.test(prev)) return REGEX_MAY_FOLLOW_KEYWORD.test(src.slice(0, j + 1))
  return false
}

/** Step the cursor past a regex literal that starts at `i` (the opening `/`). Character classes are
 *  tracked, because `/` inside `[...]` does not close the literal. */
function skipRegex(src: string, i: number): number {
  i++ // opening slash
  let inClass = false
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '\n') return i // unterminated — bail rather than eat the file
    if (c === '[') inClass = true
    else if (c === ']') inClass = false
    else if (c === '/' && !inClass) return i + 1
    i++
  }
  return i
}

/** Step the cursor past a string / template literal that starts at `i` (the opening quote). */
function skipString(src: string, i: number): number {
  const quote = src[i] as string
  i++
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') i += 2
    else if (c === quote) return i + 1
    else i++
  }
  return i
}

/**
 * Blank every comment, PRESERVING offsets — so a `.search()` / `.match()` index into the result
 * still lines up with the original file, and an ORDERING lint ("the guard must appear before the
 * native call") stays meaningful.
 *
 * String, template, and REGEX bodies are stepped OVER rather than blanked, for two different
 * reasons:
 *
 *   - a lint may legitimately match a string that IS code (`kind === 'ambiguous'`, a class name,
 *     an option key, a timeframe `'1h'`), so blanking strings would blind it; and
 *   - a `//` inside `'https://…'` is not a comment, and — the sharper edge — a `'` inside a REGEX
 *     (`/won't/`) is not a string, nor is `/*` inside a character class (`/[/*]/`). A scanner that
 *     is blind to regex literals will happily open a string or a block comment there and blank its
 *     way to the end of the file, deleting the very code the lint was hired to watch. That failure
 *     is silent and it fails OPEN.
 */
export function codeOnly(src: string): string {
  const out = src.split('')
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') out[i++] = ' '
    } else if (c === '/' && d === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' '
        i++
      }
      out[i] = ' '
      out[i + 1] = ' '
      i += 2
    } else if (c === '/' && opensRegex(src, i)) {
      i = skipRegex(src, i)
    } else if (c === "'" || c === '"' || c === '`') {
      i = skipString(src, i)
    } else {
      i++
    }
  }
  return out.join('')
}
