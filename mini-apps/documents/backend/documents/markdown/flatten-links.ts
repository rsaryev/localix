/** Read inline links without mistaking backslash-escaped user prose for Markdown syntax. */
export function flattenLinks(text: string): string {
  let output = ''
  const close = (start: number, marker: string) => {
    for (let i = start; i < text.length; i++) {
      if (text[i] === '\\') {
        i++
        continue
      }
      if (text[i] === marker) return i
    }
    return -1
  }
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      output += text.slice(i, i + 2)
      i++
      continue
    }
    const image = text[i] === '!' && text[i + 1] === '['
    const begin = image ? i + 1 : i
    if (text[begin] !== '[') {
      output += text[i]
      continue
    }
    const labelEnd = close(begin + 1, ']')
    if (labelEnd < 0) {
      output += text.slice(i)
      break
    }
    if (text[labelEnd + 1] !== '(') {
      output += text.slice(i, labelEnd + 1)
      i = labelEnd
      continue
    }
    let end = labelEnd + 2
    let depth = 1
    if (text[end] === '<') {
      const angleEnd = close(end + 1, '>')
      if (angleEnd >= 0 && text[angleEnd + 1] === ')') {
        end = angleEnd + 1
        depth = 0
      }
    }
    for (; depth > 0 && end < text.length; end++) {
      if (text[end] === '\\') {
        end++
        continue
      }
      if (text[end] === '(') depth++
      if (text[end] === ')' && --depth === 0) break
    }
    if (depth !== 0) {
      output += text.slice(i)
      break
    }
    const label = text.slice(begin + 1, labelEnd)
    let url = text.slice(labelEnd + 2, end)
    if (url.startsWith('<') && url.endsWith('>')) url = url.slice(1, -1)
    // URL underscores and asterisks remain URL text, not character-formatting markers.
    const literalUrl = url.replace(/[\\*_`]/g, '\\$&')
    output += !image && url && url !== label ? `${label} (${literalUrl})` : label
    i = end
  }
  return output
}
