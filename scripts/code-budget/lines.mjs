// Counts the lines of code in a source file: lines holding at least one character that is neither
// whitespace nor part of a comment. TypeScript and JavaScript are parsed, so a `//` in a string,
// a template or a regular expression is never taken for a comment; Rust and CSS are lexed.
import { parseSync } from 'oxc-parser'

/**
 * @param {string} source
 * @param {string} file used for its extension, and named when the file does not parse
 */
export function codeLines(source, file) {
  const comments = file.endsWith('.rs')
    ? rustComments(source)
    : file.endsWith('.css')
      ? cssComments(source)
      : scriptComments(source, file)
  return countLines(source, comments)
}

/** @param {string} source @param {[number, number][]} comments sorted [start, end) ranges */
function countLines(source, comments) {
  let lines = 0
  let hasCode = false
  let next = 0
  for (let index = 0; index < source.length; index++) {
    while (next < comments.length && comments[next][1] <= index) next++
    const char = source[index]
    if (char === '\n') {
      if (hasCode) lines++
      hasCode = false
      continue
    }
    const inComment = next < comments.length && comments[next][0] <= index
    if (!inComment && char !== ' ' && char !== '\t' && char !== '\r') hasCode = true
  }
  return hasCode ? lines + 1 : lines
}

/** @param {string} source @param {string} file */
function scriptComments(source, file) {
  const result = parseSync(file, source)
  if (result.errors.length > 0) {
    throw new Error(`${file} does not parse: ${result.errors[0]?.message ?? 'syntax error'}`)
  }
  return result.comments.map((comment) => jsxCommentBraces(source, comment.start, comment.end))
}

// A JSX comment sits in braces, `{/* … */}`: the braces belong to the comment, not to the code.
function jsxCommentBraces(source, start, end) {
  let before = start - 1
  while (source[before] === ' ' || source[before] === '\t') before--
  let after = end
  while (source[after] === ' ' || source[after] === '\t') after++
  return source[before] === '{' && source[after] === '}' ? [before, after + 1] : [start, end]
}

/** CSS has only block comments; strings may hold `/*`. @param {string} source */
function cssComments(source) {
  /** @type {[number, number][]} */
  const ranges = []
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (char === '"' || char === "'") index = skipString(source, index, char)
    else if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      const stop = end === -1 ? source.length : end + 2
      ranges.push([index, stop])
      index = stop - 1
    }
  }
  return ranges
}

/** Rust: line comments and nested block comments; strings, raw strings and char literals. */
function rustComments(source) {
  /** @type {[number, number][]} */
  const ranges = []
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    const next = source[index + 1]
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index)
      const stop = end === -1 ? source.length : end
      ranges.push([index, stop])
      index = stop - 1
    } else if (char === '/' && next === '*') {
      let depth = 1
      let cursor = index + 2
      while (cursor < source.length && depth > 0) {
        if (source[cursor] === '/' && source[cursor + 1] === '*') {
          depth++
          cursor += 2
        } else if (source[cursor] === '*' && source[cursor + 1] === '/') {
          depth--
          cursor += 2
        } else cursor++
      }
      ranges.push([index, cursor])
      index = cursor - 1
    } else if (
      char === 'r' &&
      !isIdent(source[index - 1]) &&
      rawStringHashes(source, index) !== null
    ) {
      const hashes = '#'.repeat(rawStringHashes(source, index) ?? 0)
      const close = source.indexOf(QUOTE + hashes, index + hashes.length + 2)
      index = close === -1 ? source.length : close + hashes.length
    } else if (char === '"') {
      index = skipString(source, index, '"')
    } else if (char === "'") {
      // A char literal ('a', '\n', '"') closes within a few characters; a lifetime ('a) does not.
      const literal = /^'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|.)|[^\\'\n])'/u.exec(
        source.slice(index, index + 12),
      )
      if (literal) index += literal[0].length - 1
    }
  }
  return ranges
}

const QUOTE = '"'

/** How many `#` open a raw string `r#…"` at `index`, or null when none starts there. */
function rawStringHashes(source, index) {
  let cursor = index + 1
  while (source[cursor] === '#') cursor++
  return source[cursor] === QUOTE ? cursor - index - 1 : null
}

/** @param {string | undefined} char */
const isIdent = (char) => char !== undefined && /[A-Za-z0-9_]/u.test(char)

/** The index of the quote that closes the string opened at `start`. */
function skipString(source, start, quote) {
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] === '\\') index++
    else if (source[index] === quote) return index
  }
  return source.length
}
