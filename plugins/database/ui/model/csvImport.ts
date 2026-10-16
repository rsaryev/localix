// Convert CSV/TSV text into INSERT statements for a known table — the import counterpart
// to the INSERT export. Pure + framework-free; the console loads the result into the
// editor for review before running. Reuses the dataview delimited parser (quoted fields,
// embedded newlines) and the shared PK-keyed INSERT builder.
import { parseDelimited } from '@localixai/dataview'
import { buildInsert, type MutationTarget } from './rowMutations'
import { defineRecordValue } from '../../shared/safe-record'

export interface CsvImportResult {
  /** Generated INSERT statements (one per data row), newline-joined. */
  sql: string
  rowCount: number
  /** Header names parsed from the first row. */
  columns: string[]
}

/** Empty → NULL; an unambiguous number → a number; everything else stays a string. */
function parseCell(raw: string | undefined): unknown {
  if (raw === undefined) return null
  const t = raw.trim()
  if (t === '') return null
  // Plain integer/decimal only — never coerce ids with leading zeros or +/exponent noise.
  if (/^-?(0|[1-9]\d*)$/.test(t)) {
    const number = Number(t)
    return Number.isSafeInteger(number) ? number : BigInt(t)
  }
  if (/^-?(0|[1-9]\d*)\.\d+$/.test(t)) {
    const number = Number(t)
    const normalized = t.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
    // Keep a high-precision decimal as text when Number would change its digits. SQL
    // engines coerce the quoted exact text into a numeric destination without rounding
    // it in JavaScript first.
    return Number.isFinite(number) && String(number) === normalized ? number : t
  }
  return raw
}

function assertClosedQuotes(text: string): void {
  let inQuotes = false
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '"') continue
    if (inQuotes && text[index + 1] === '"') {
      index++
      continue
    }
    inQuotes = !inQuotes
  }
  if (inQuotes) throw new Error('CSV contains an unclosed quoted field.')
}

export function csvToInserts(
  text: string,
  target: MutationTarget,
  delimiter = ',',
): CsvImportResult {
  assertClosedQuotes(text)
  const rows = parseDelimited(text, delimiter).filter((r) => !(r.length === 1 && r[0] === ''))
  if (rows.length === 0) return { sql: '', rowCount: 0, columns: [] }

  const headers = (rows[0] ?? []).map((h) => h.trim())
  const emptyHeader = headers.findIndex((header) => header === '')
  if (emptyHeader >= 0) {
    throw new Error(`CSV header column ${emptyHeader + 1} has no name.`)
  }
  const seenHeaders = new Set<string>()
  for (const header of headers) {
    if (seenHeaders.has(header)) {
      throw new Error(`CSV header contains the duplicate column "${header}".`)
    }
    seenHeaders.add(header)
  }

  const body = rows.slice(1)
  const statements = body.map((cells, rowIndex) => {
    if (cells.length > headers.length) {
      throw new Error(
        `CSV data row ${rowIndex + 1} has ${cells.length} values for ${headers.length} columns.`,
      )
    }
    const record: Record<string, unknown> = {}
    headers.forEach((h, i) => {
      defineRecordValue(record, h, parseCell(cells[i]))
    })
    return buildInsert(target, record)
  })
  return { sql: statements.join('\n'), rowCount: statements.length, columns: headers }
}
