import type { TableCellType, TableCellValue, TableColumn, TableRow } from './model'

const COLUMN_INFERENCE_SAMPLE_SIZE = 200

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/
const BOOL_RE = /^(true|false|yes|no)$/i

/** Infer a column type from a sample of raw string values. */
export function inferType(values: Array<string | null | undefined>): TableCellType {
  const nonEmpty = values.flatMap((v) => {
    if (v === null || v === undefined) return []
    const s = String(v).trim()
    return s !== '' ? [s] : []
  })
  if (nonEmpty.length === 0) return 'text'

  let allInt = true
  let allNum = true
  let allBool = true
  let allDate = true
  for (const s of nonEmpty) {
    if (allBool && !BOOL_RE.test(s)) allBool = false
    const num = Number(s)
    if (Number.isNaN(num)) {
      allNum = false
      allInt = false
    } else if (!Number.isInteger(num)) {
      allInt = false
    }
    if (allDate && !ISO_DATE_RE.test(s)) allDate = false
  }
  if (allInt) return 'int'
  if (allNum) return 'float'
  if (allBool) return 'bool'
  if (allDate) return 'date'
  return 'text'
}

function inferTypeFromValues(values: TableCellValue[]): TableCellType {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== '')
  if (nonNull.length === 0) return 'text'
  if (nonNull.every((v) => typeof v === 'boolean')) return 'bool'
  if (nonNull.every((v) => typeof v === 'number')) {
    return nonNull.every((v) => Number.isInteger(v as number)) ? 'int' : 'float'
  }
  return inferType(nonNull.map((v) => String(v)))
}

function makeColumnId(title: string, index: number, used: Set<string>): string {
  const base =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || `col_${index + 1}`
  let id = base
  let n = 2
  while (used.has(id)) id = `${base}_${n++}`
  used.add(id)
  return id
}

/** Infer columns (id + title + type) from CSV headers + a sample of data rows. */
export function inferColumns(headers: string[], sampleRows: string[][]): TableColumn[] {
  const used = new Set<string>()
  const sample = sampleRows.slice(0, COLUMN_INFERENCE_SAMPLE_SIZE)
  return headers.map((h, idx) => {
    const title = (h ?? '').trim() || `Column ${idx + 1}`
    const id = makeColumnId(title, idx, used)
    const colValues = sample.map((r) => r[idx] ?? '')
    return { id, title, type: inferType(colValues) }
  })
}

/** Infer columns from an array of row objects (JSON). Object keys are the ids. */
export function inferColumnsFromObjects(rows: TableRow[]): TableColumn[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const r of rows.slice(0, COLUMN_INFERENCE_SAMPLE_SIZE)) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    }
  }
  return keys.map((k) => {
    const sample = rows.slice(0, COLUMN_INFERENCE_SAMPLE_SIZE).map((r) => r[k])
    return { id: k, title: k, type: inferTypeFromValues(sample) }
  })
}
