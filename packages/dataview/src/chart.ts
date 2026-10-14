/**
 * Chart specs are agnostic data: which columns map to which visual encoding,
 * for a given chart kind. The set of kinds is extensible — adding a kind here
 * plus a renderer in the UI registry is all it takes (no core rewrite).
 */

import { isNumericType, type TableColumn } from './model'

export type ChartKind = 'bar' | 'line' | 'area' | 'pie' | 'scatter'

export const CHART_KINDS: readonly ChartKind[] = ['bar', 'line', 'area', 'pie', 'scatter']

export const VIEW_KINDS = ['table', ...CHART_KINDS] as const
export type ViewKind = (typeof VIEW_KINDS)[number]

export interface ChartSpec {
  kind: ChartKind
  /** Category / x-axis column id (slice label for pie). */
  x?: string
  /** Value column id(s). Multiple = multi-series (wide format). */
  y?: string | string[]
  /** Long-format series splitter column id (alternative to multiple y). */
  series?: string
  /** Stack bars/areas instead of grouping. */
  stack?: boolean
}

export interface ChartEncodingReq {
  x: 'required' | 'optional'
  y: 'required' | 'optional'
  /** Whether the kind meaningfully supports more than one y column. */
  multiY: boolean
  /** y must reference numeric columns. */
  numericY: boolean
}

export function requiredEncodings(kind: ChartKind): ChartEncodingReq {
  switch (kind) {
    case 'pie':
      return { x: 'required', y: 'required', multiY: false, numericY: true }
    case 'scatter':
      return { x: 'required', y: 'required', multiY: false, numericY: true }
    case 'bar':
    case 'line':
    case 'area':
      return { x: 'required', y: 'required', multiY: true, numericY: true }
  }
}

export function normalizeY(y: ChartSpec['y']): string[] {
  if (!y) return []
  return Array.isArray(y) ? y : [y]
}

/** Pick sensible default encodings for a kind given the available columns. */
export function defaultChartSpec(kind: ChartKind, columns: TableColumn[]): ChartSpec {
  const numeric = columns.filter((c) => isNumericType(c.type))
  const firstNonNumeric = columns.find((c) => !isNumericType(c.type))

  if (kind === 'scatter') {
    const x = numeric[0]?.id ?? columns[0]?.id
    const y = numeric[1]?.id ?? numeric[0]?.id ?? columns[1]?.id
    return { kind, x, y }
  }

  if (kind === 'pie') {
    const x = firstNonNumeric?.id ?? columns[0]?.id
    const y = numeric[0]?.id ?? columns[1]?.id
    return { kind, x, y }
  }

  // bar / line / area: category x + all remaining numeric columns as series
  const x = firstNonNumeric?.id ?? columns[0]?.id
  const y = numeric.flatMap((c) => (c.id !== x ? [c.id] : []))
  return { kind, x, y: y.length > 0 ? y : numeric.map((c) => c.id) }
}

export function validateChartSpec(
  spec: ChartSpec,
  columns: TableColumn[],
): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  const byId = new Map(columns.map((c) => [c.id, c]))
  const req = requiredEncodings(spec.kind)

  if (req.x === 'required' && !spec.x) errors.push('Missing x column')
  if (spec.x && !byId.has(spec.x)) errors.push(`Unknown x column: ${spec.x}`)

  const ys = normalizeY(spec.y)
  if (req.y === 'required' && ys.length === 0) errors.push('Missing y column')
  for (const y of ys) {
    const col = byId.get(y)
    if (!col) {
      errors.push(`Unknown y column: ${y}`)
    } else if (req.numericY && !isNumericType(col.type)) {
      errors.push(`y column must be numeric: ${y}`)
    }
  }
  if (!req.multiY && ys.length > 1) errors.push(`${spec.kind} supports a single y column`)

  if (spec.series && !byId.has(spec.series)) errors.push(`Unknown series column: ${spec.series}`)

  return { ok: errors.length === 0, errors }
}

export function isChartKind(value: string): value is ChartKind {
  return (CHART_KINDS as readonly string[]).includes(value)
}
