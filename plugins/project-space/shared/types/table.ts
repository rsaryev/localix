import { z } from 'zod'
import type { ElementTypeSpec } from '../registry/contract'

export const TABLE_LIMIT = { columns: 20, rows: 200 }
const props = z
  .object({
    title: z.string().default('Table'),
    columns: z.array(z.string()).min(1).max(TABLE_LIMIT.columns).default(['Column 1', 'Column 2']),
    rows: z
      .array(z.array(z.string()))
      .max(TABLE_LIMIT.rows)
      .default([
        ['', ''],
        ['', ''],
      ]),
  })
  .superRefine((value, ctx) => {
    value.rows.forEach((row, index) => {
      if (row.length !== value.columns.length)
        ctx.addIssue({
          code: 'custom',
          path: ['rows', index],
          message: 'Every row must have one cell per column',
        })
    })
  })
export type TableProps = z.infer<typeof props>

const escape = (text: string) =>
  text
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')
    .replace(/^ +| +$/gu, (spaces) => '\\u0020'.repeat(spaces.length))
const line = (cells: string[]) => `| ${cells.map(escape).join(' | ')} |`
export function writeTable(value: Pick<TableProps, 'columns' | 'rows'>): string {
  return [line(value.columns), line(value.columns.map(() => '---')), ...value.rows.map(line)].join(
    '\n',
  )
}

function cells(line: string): string[] {
  const out: string[] = []
  let cell = ''
  const decode = (value: string) =>
    value
      .trim()
      .replace(/\\(u[\da-f]{4}|[\s\S])/giu, (_, ch: string) =>
        ch.startsWith('u') && ch.length === 5
          ? String.fromCharCode(Number.parseInt(ch.slice(1), 16))
          : ch === 'n'
            ? '\n'
            : ch === 'r'
              ? '\r'
              : ch === 't'
                ? '\t'
                : ch,
      )
  const text = line.trim().replace(/^\|/u, '').replace(/\|$/u, '')
  for (let at = 0; at < text.length; at++) {
    const ch = text[at]!
    if (ch === '\\' && at + 1 < text.length) {
      const next = text[++at]!
      cell += `\\${next}`
    } else if (ch === '|') {
      out.push(decode(cell))
      cell = ''
    } else cell += ch
  }
  out.push(decode(cell))
  return out
}

export function readTable(text: string): Pick<TableProps, 'columns' | 'rows'> | string {
  const lines = text
    .trim()
    .replace(/^```(?:markdown|md)?\s*\n|\n```$/gu, '')
    .split(/\r?\n/u)
  if (lines.length < 2 || !cells(lines[1]!).every((cell) => /^:?-{3,}:?$/u.test(cell)))
    return 'Use a Markdown table with a header and a --- separator row.'
  const value = {
    columns: cells(lines[0]!),
    rows: lines
      .slice(2)
      .filter((line) => line.trim())
      .map(cells),
  }
  if (cells(lines[1]!).length !== value.columns.length)
    return 'The separator must have one cell per column.'
  const parsed = props.safeParse(value)
  return parsed.success ? value : parsed.error.issues[0]!.message
}

export const tableType: ElementTypeSpec<TableProps> = {
  type: 'table',
  version: 1,
  label: 'Table / Grid',
  description:
    'An editable native table. props: title, columns (header strings), rows (arrays of string cells of the same width). text accepts a Markdown table. Up to 20 columns and 200 rows.',
  props: props as unknown as ElementTypeSpec<TableProps>['props'],
  size: { w: 420, h: 240 },
  minSize: { w: 200, h: 140 },
  text: writeTable,
  fromText: readTable,
  claimsText: (text) => /^\s*(?:```(?:markdown|md)?\s*\n)?\|[^\n]*\n\|[\s:|-]+\|/u.test(text),
  measure: (value) => ({
    w: Math.min(1000, Math.max(360, value.columns.length * 160 + 48)),
    h: Math.min(700, Math.max(200, 94 + value.rows.length * 30)),
  }),
}
