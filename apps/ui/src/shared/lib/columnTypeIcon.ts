import { Hash, Type, Calendar, ToggleLeft, Braces, Binary } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Coarse semantic family a column's data type falls into — the seam between the raw
 * (or normalized) type string and the header glyph. Kept separate from the icon so the
 * mapping is pure + trivially testable without importing any React/lucide component.
 */
export type ColumnTypeKind = 'numeric' | 'text' | 'date' | 'bool' | 'json' | 'binary'

/**
 * Classify a column type string into a coarse family. Accepts BOTH the normalized
 * dataview `TableCellType` (`number`/`int`/`float`/`text`/`bool`/`date`) AND raw DB type
 * names (`varchar`, `timestamptz`, `jsonb`, `bigint`, …) via keyword matching, so it stays
 * correct wherever the column type comes from. Order matters: json/bool/date are checked
 * before the generic numeric/text buckets (e.g. `boolean` must not fall into text).
 */
export function columnTypeKind(type: string): ColumnTypeKind {
  const t = type.toLowerCase()
  if (t.includes('json')) return 'json'
  if (t.includes('bool')) return 'bool'
  if (t.includes('date') || t.includes('time') || t.includes('timestamp')) return 'date'
  if (t.includes('bytea') || t.includes('blob') || t.includes('binary')) return 'binary'
  if (
    t === 'number' ||
    t.includes('int') ||
    t.includes('float') ||
    t.includes('double') ||
    t.includes('real') ||
    t.includes('decimal') ||
    t.includes('numeric') ||
    t.includes('serial') ||
    t.includes('money')
  ) {
    return 'numeric'
  }
  return 'text'
}

const KIND_ICON: Record<ColumnTypeKind, LucideIcon> = {
  numeric: Hash,
  text: Type,
  date: Calendar,
  bool: ToggleLeft,
  json: Braces,
  binary: Binary,
}

/** The lucide glyph that cues a column's data-type family in a grid header. */
export function columnTypeIcon(type: string): LucideIcon {
  return KIND_ICON[columnTypeKind(type)]
}
