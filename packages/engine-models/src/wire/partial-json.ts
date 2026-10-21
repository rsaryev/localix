/**
 * The value a JSON text that is still streaming will become, as far as it has come: an open
 * string is closed, open objects and arrays are closed, a half-written literal or number is
 * finished or dropped, and a dangling key, colon or comma is dropped. Lets a tool card show a
 * file's content while the model is still writing it. Undefined when nothing usable has arrived.
 *
 * One linear pass over the text, then one `JSON.parse`: the stream calls this on a growing
 * buffer, so a pass that rescans or retries would make a long `write` quadratic.
 */
export function parsePartialJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  // Mid-stream the text almost never ends a document; a failed parse costs a full scan.
  const last = trimmed[trimmed.length - 1]
  if (last === '}' || last === ']') {
    try {
      return JSON.parse(trimmed)
    } catch {
      // A model's slightly broken JSON: repaired below.
    }
  }
  const scanned = completeJson(trimmed)
  const completed = scanned === REPAIR ? completeJson(repairStrings(trimmed)) : scanned
  if (completed === undefined || completed === REPAIR) return undefined
  try {
    return JSON.parse(completed)
  } catch {
    return undefined
  }
}

/** A finished JSON text that `JSON.parse` refused only for its strings' escapes, repaired. */
export function parseJsonLenient(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    const repaired = repairStrings(text)
    if (repaired === text) throw error
    return JSON.parse(repaired)
  }
}

const VALID_ESCAPES = '"\\/bfnrtu'
const HEX4 = /^[0-9a-fA-F]{4}$/u

/**
 * Inside strings: a raw control character is escaped and a backslash before a character JSON
 * does not escape (`\d` from a regex) is doubled. An escape cut off by the end of the text is
 * left for `completeJson` to drop.
 */
function repairStrings(input: string): string {
  let out = ''
  let copied = 0
  let inString = false
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!
    if (!inString) {
      if (char === '"') inString = true
      continue
    }
    if (char === '"') {
      inString = false
    } else if (char === '\\') {
      const next = input[i + 1]
      if (next === undefined) break
      const truncatedUnicode = next === 'u' && i + 6 > input.length
      if (VALID_ESCAPES.includes(next) && (next !== 'u' || truncatedUnicode)) {
        i++
      } else if (next === 'u' && HEX4.test(input.slice(i + 2, i + 6))) {
        i += 5
      } else {
        out += input.slice(copied, i) + '\\\\'
        copied = i + 1
      }
    } else if (char.charCodeAt(0) < 0x20) {
      out += input.slice(copied, i) + `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
      copied = i + 1
    }
  }
  return copied === 0 ? input : out + input.slice(copied)
}

/** What an object or array waits for next. */
type Expect = 'key' | 'colon' | 'value' | 'comma'

const LITERALS = ['true', 'false', 'null'] as const

/** `completeJson`'s answer when a string needs `repairStrings` before it can stand. */
const REPAIR = Symbol('repair')

/**
 * The longest prefix that stands as JSON once its open containers are closed, closed. The scan
 * remembers the last point where everything before it was complete (`cut`) and how deep the
 * containers were there; a value still being written at the end is finished where it can be.
 */
function completeJson(input: string): string | undefined | typeof REPAIR {
  const stack: Array<'}' | ']'> = []
  const expect: Expect[] = []
  let cut = 0
  let cutDepth = 0
  // The value open at the end of the text, if any: where it started and what it is.
  let open: { start: number; kind: 'string' | 'number' | 'literal'; key: boolean } | undefined

  const valueDone = (end: number) => {
    if (expect.length > 0) expect[expect.length - 1] = 'comma'
    cut = end
    cutDepth = stack.length
  }

  let i = 0
  while (i < input.length) {
    const char = input[i]!
    const top = expect[expect.length - 1]
    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
      i++
      continue
    }
    if (char === '"') {
      const start = i
      const key = stack[stack.length - 1] === '}' && top === 'key'
      i++
      while (i < input.length && input[i] !== '"') {
        const code = input.charCodeAt(i)
        if (code === 0x5c) {
          const next = input[i + 1]
          if (next !== undefined && !VALID_ESCAPES.includes(next)) return REPAIR
          i += 2
        } else if (code < 0x20) return REPAIR
        else i++
      }
      if (i >= input.length) {
        open = { start, kind: 'string', key }
        break
      }
      i++
      if (key) expect[expect.length - 1] = 'colon'
      else valueDone(i)
      continue
    }
    if (char === '{' || char === '[') {
      stack.push(char === '{' ? '}' : ']')
      expect.push(char === '{' ? 'key' : 'value')
      i++
      cut = i
      cutDepth = stack.length
      continue
    }
    if (char === '}' || char === ']') {
      stack.pop()
      expect.pop()
      i++
      valueDone(i)
      continue
    }
    if (char === ':') {
      expect[expect.length - 1] = 'value'
      i++
      continue
    }
    if (char === ',') {
      expect[expect.length - 1] = stack[stack.length - 1] === '}' ? 'key' : 'value'
      i++
      continue
    }
    // A number or a literal: it runs to the next delimiter.
    const start = i
    while (i < input.length && !' \n\r\t,:]}'.includes(input[i]!)) i++
    const kind = char === '-' || (char >= '0' && char <= '9') ? 'number' : 'literal'
    if (i >= input.length) {
      open = { start, kind, key: false }
      break
    }
    valueDone(i)
  }

  let tail = ''
  if (open && !open.key) {
    const written = input.slice(open.start)
    tail = finishValue(written, open.kind) ?? ''
    if (tail) {
      cut = open.start
      cutDepth = stack.length
    }
  }
  if (cut === 0 && !tail) return undefined
  return input.slice(0, cut) + tail + stack.slice(0, cutDepth).reverse().join('')
}

/** A value cut off by the end of the text, finished; undefined when nothing of it can stand. */
function finishValue(written: string, kind: 'string' | 'number' | 'literal'): string | undefined {
  if (kind === 'string') return `${written.slice(0, openEscapeAt(written))}"`
  if (kind === 'number') {
    const number = written.replace(/[.eE+-]+$/u, '')
    return /\d$/u.test(number) ? number : undefined
  }
  return LITERALS.find((literal) => literal.startsWith(written))
}

/**
 * Where an escape the text ends inside begins (`\`, `\u`, `\u12`), or the text's length when it
 * ends on a complete character. Read from the end: `\\` is a complete escape, so only an odd
 * run of backslashes opens one.
 */
function openEscapeAt(text: string): number {
  let end = text.length
  let hex = 0
  while (hex < 4 && end > 0 && /[0-9a-fA-F]/u.test(text[end - 1]!)) {
    end--
    hex++
  }
  const unicode = hex < 4 && end > 0 && text[end - 1] === 'u'
  const runEnd = unicode ? end - 1 : text.length
  let start = runEnd
  while (start > 0 && text[start - 1] === '\\') start--
  if ((runEnd - start) % 2 === 1) return runEnd - 1
  return text.length
}
