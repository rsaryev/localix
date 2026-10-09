export function normalizeUnicode(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, ' ')
}

function leadingWs(s: string): string {
  return s.match(/^[ \t]*/)?.[0] ?? ''
}

/**
 * When a match was found by a non-exact strategy, the replacement lines were
 * written with the pattern's indentation, which may differ from the file's.
 * Shift every inserted line by the delta between the pattern's first old line and
 * the actual matched file line so the block lands at the file's indentation.
 */
export function reindentNewLines(
  newLines: string[],
  oldFirst: string,
  fileFirst: string,
): string[] {
  const oldIndent = leadingWs(oldFirst)
  const fileIndent = leadingWs(fileFirst)
  if (oldIndent === fileIndent) return newLines
  return newLines.map((line) => {
    if (line.trim() === '') return line
    const stripped = line.startsWith(oldIndent)
      ? line.slice(oldIndent.length)
      : line.replace(/^[ \t]*/, '')
    return fileIndent + stripped
  })
}

const ESCAPE_MAP: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  f: '\f',
  v: '\v',
  '0': '\0',
  '"': '"',
  "'": "'",
  '`': '`',
  '\\': '\\',
}

/**
 * Convert literal escape sequences (the two chars backslash-n/-t/-" etc.) into
 * the characters they denote — for the common failure where a model double-
 * escapes match text in the tool-call JSON so it can't be found in the file.
 * Single-pass so `\\` is consumed as one unit (no sequential-replace order bug).
 * `includeNewlines` is OFF for apply_patch's per-line use (a `\n` inside a single
 * patch line must stay literal, never split the line) and ON (the default) when a
 * caller unescapes a whole multi-line string at once.
 */
export function unescapeLiteral(s: string, includeNewlines = true): string {
  const re = includeNewlines ? /\\([ntrfv0"'`\\])/g : /\\([trfv0"'`\\])/g
  return s.replace(re, (m, c: string) => ESCAPE_MAP[c] ?? m)
}
