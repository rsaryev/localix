/**
 * The value a JSON text that is still streaming will become, as far as it has come: an open
 * string is closed, open objects and arrays are closed, and a dangling key, colon or comma is
 * dropped. Lets a tool card show a file's content while the model is still writing it.
 * Undefined when nothing usable has arrived yet.
 */
export function parsePartialJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    // Still streaming: repair below.
  }
  const closers: string[] = []
  let inString = false
  let escaped = false
  for (const char of trimmed) {
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') closers.push('}')
    else if (char === '[') closers.push(']')
    else if (char === '}' || char === ']') closers.pop()
  }
  let repaired = trimmed
  // A string cut off mid-escape loses the lone backslash; any other is simply closed.
  if (inString) repaired = (escaped ? repaired.slice(0, -1) : repaired) + '"'
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = repaired + [...closers].reverse().join('')
    try {
      return JSON.parse(candidate)
    } catch {
      // Drop what cannot stand yet: a trailing comma or colon, or a key without its value.
      repaired = repaired
        .replace(/,\s*$/u, '')
        .replace(/,?\s*"(?:[^"\\]|\\.)*"\s*:\s*$/u, '')
        .replace(/,\s*"(?:[^"\\]|\\.)*"\s*$/u, '')
        .replace(/:\s*$/u, '')
    }
  }
  return undefined
}
