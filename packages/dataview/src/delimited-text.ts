/** Split delimited text into a matrix of string cells. */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  // A field can be present and still be EMPTY — `""` is a field, the absence of one
  // is not. Length alone cannot tell them apart, so remember that a field was opened.
  // Without this, a one-column file ending in `""` (no trailing newline) lost its
  // last row entirely: at EOF both `field` and `row` were empty, exactly as they are
  // after a normal trailing terminator.
  let fieldOpened = false
  let i = 0
  const n = text.length
  if (n > 0 && text.charCodeAt(0) === 0xfeff) i = 1 // strip BOM

  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      fieldOpened = true
      i++
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      fieldOpened = false
      i++
      continue
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field)
      field = ''
      fieldOpened = false
      rows.push(row)
      row = []
      if (ch === '\r' && text[i + 1] === '\n') i += 2
      else i++
      continue
    }
    field += ch
    i++
  }
  // A trailing terminator ENDS the last record rather than starting another, so an
  // empty tail is normally nothing. `fieldOpened` is what distinguishes that from a
  // real, explicitly-quoted empty final field.
  if (field.length > 0 || row.length > 0 || fieldOpened) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
