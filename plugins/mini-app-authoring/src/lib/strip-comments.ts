/**
 * Source text with its comments removed and its line count kept, so a check that matches code is
 * not satisfied by commented-out code and still reports the right line. Strings, template literals
 * (with their substitutions) and regular expression literals are kept whole: `'//'` in a string is
 * not a comment.
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

function regexMayStart(emitted: string): boolean {
  let i = emitted.length - 1
  while (i >= 0 && /\s/.test(emitted[i] as string)) i--
  if (i < 0) return true // start of file

  const ch = emitted[i] as string
  if (ch === ')' || ch === ']' || ch === "'" || ch === '"' || ch === '`') return false
  if (/[\w$]/.test(ch)) {
    let j = i
    while (j >= 0 && /[\w$]/.test(emitted[j] as string)) j--
    const word = emitted.slice(j + 1, i + 1)
    if (/^\d/.test(word)) return false // numeric literal → division
    return REGEX_PRECEDING_KEYWORDS.has(word)
  }
  return true
}

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

export function stripComments(src: string): string {
  let out = ''
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
