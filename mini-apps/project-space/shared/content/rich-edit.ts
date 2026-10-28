/**
 * Edits of rich text as TEXT, for the keys a person formats with while typing: ⌘B wraps the
 * selection in `**`, Enter at the end of a list item starts the next one. Each returns the new
 * value and where the selection goes, so the editor stays a plain text field and undo stays one
 * value. Pure, and the reason the editor needs no document model.
 */
export interface TextEdit {
  value: string
  start: number
  end: number
}

/** Wrap the selection in `token`, or take it off when the selection is already wrapped. */
export function toggleMark(value: string, start: number, end: number, token: string): TextEdit {
  const size = token.length
  // The wrap sits just outside the selection: `**|word|**`.
  if (value.slice(start - size, start) === token && value.slice(end, end + size) === token)
    return {
      value: value.slice(0, start - size) + value.slice(start, end) + value.slice(end + size),
      start: start - size,
      end: end - size,
    }
  const selected = value.slice(start, end)
  // The wrap is inside it: `|**word**|`.
  if (selected.length > size * 2 && selected.startsWith(token) && selected.endsWith(token)) {
    const inner = selected.slice(size, -size)
    return {
      value: value.slice(0, start) + inner + value.slice(end),
      start,
      end: start + inner.length,
    }
  }
  if (start === end)
    return {
      value: value.slice(0, start) + token + token + value.slice(end),
      start: start + size,
      end: start + size,
    }
  // A mark never spans lines, and its token must touch text: wrap each line's words, leaving
  // the spaces around them outside, or `** word**` would not read as bold.
  const wrapped = selected
    .split('\n')
    .map((line) => {
      const words = /^(\s*)(.*?)(\s*)$/su.exec(line)
      return words?.[2] ? `${words[1]}${token}${words[2]}${token}${words[3]}` : line
    })
    .join('\n')
  return {
    value: value.slice(0, start) + wrapped + value.slice(end),
    start,
    end: start + wrapped.length,
  }
}

const ITEM = /^(\s*)([-*+]\s+\[[ xX]\]|[-*+]|\d{1,4}[.)])(\s+)(.*)$/u

/**
 * Enter at the end of a list item: the next item, numbered one on, a task box empty. Enter on an
 * item with nothing after its marker ends the list instead, as every editor does. `null` when
 * the caret is not at the end of a list line, so the field inserts its plain line break.
 */
export function continueList(value: string, caret: number): TextEdit | null {
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1
  const lineEnd = value.indexOf('\n', caret)
  if (value.slice(caret, lineEnd < 0 ? undefined : lineEnd).trim()) return null
  const line = value.slice(lineStart, caret)
  const match = ITEM.exec(line)
  if (!match) return null
  const [, indent = '', marker = '', gap = ' ', rest = ''] = match
  if (!rest.trim()) {
    // An empty item: leave the list, keeping the line itself.
    return {
      value: value.slice(0, lineStart) + value.slice(caret),
      start: lineStart,
      end: lineStart,
    }
  }
  const numbered = /^(\d{1,4})([.)])$/u.exec(marker)
  const next = numbered
    ? `${Number(numbered[1]) + 1}${numbered[2]}`
    : marker.includes('[')
      ? `${marker[0]} [ ]`
      : marker
  const insert = `\n${indent}${next}${gap}`
  return {
    value: value.slice(0, caret) + insert + value.slice(caret),
    start: caret + insert.length,
    end: caret + insert.length,
  }
}
