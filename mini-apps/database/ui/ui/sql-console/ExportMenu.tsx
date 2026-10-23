/** Export/import dropdown in the run bar: TSV copy, CSV/JSON/SQL downloads, and the
 *  CSV import picker (editable tables only). */
import { useRef } from 'react'
import { ChevronDown, Download } from 'lucide-react'
import { copyText } from '@localixai/mini-app-sdk/ui/interactions'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@localixai/kit/dropdown-menu'
import { toCsv } from '@localixai/dataview'
import type { TableRow } from '@localixai/dataview'
import {
  adaptedRowsForTextExport,
  adaptedRowsToRecords,
  type AdaptedResult,
} from '../../model/resultAdapter'
import { exactJsonReplacer } from '../../../shared/exact-json'
import { downloadTextFile } from '../../model/download'
import { buildInsertsFromRows, type RowEditTarget } from '../../model/rowMutations'
import { ConsoleToolButton } from '../consoleActions'

export function ExportMenu({
  rows,
  result,
  edit,
  onImportCsv,
}: {
  rows: TableRow[]
  result: AdaptedResult | null | undefined
  edit: RowEditTarget | undefined
  onImportCsv: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>
}) {
  const csvInputRef = useRef<HTMLInputElement>(null)

  const exportCsv = () => {
    if (!result) return
    downloadTextFile(
      'query-result.csv',
      'text/csv',
      toCsv(result.columns, adaptedRowsForTextExport(result, rows)),
    )
  }
  const exportJson = () => {
    if (!result) return
    const records = adaptedRowsToRecords(result, rows)
    downloadTextFile(
      'query-result.json',
      'application/json',
      JSON.stringify(
        records,
        (key, value) => {
          if (value instanceof Uint8Array)
            return { type: 'Buffer', data: Array.from(value) } as const
          return exactJsonReplacer(key, value)
        },
        2,
      ),
    )
  }
  // Export the current rows as seed INSERT statements — only when the result maps to a
  // known table (the same single-table target that gates row editing).
  const exportInserts = () => {
    if (!result || !edit) return
    downloadTextFile(
      'query-result.sql',
      'application/sql',
      buildInsertsFromRows(edit, result.columns, adaptedRowsToRecords(result, rows)),
    )
  }
  const copyTsv = () => {
    if (!result) return
    void copyText(
      toCsv(result.columns, adaptedRowsForTextExport(result, rows), '\t'),
      'Rows as TSV',
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* The bar's own button, not a padding-sized one (24px in a 20px row). */}
          <ConsoleToolButton title="Export / import data">
            <Download className="size-3" />
            Export
            <ChevronDown className="size-3 opacity-60" />
          </ConsoleToolButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {result && <DropdownMenuItem onSelect={copyTsv}>Copy (TSV)</DropdownMenuItem>}
          {result && <DropdownMenuItem onSelect={exportCsv}>Download CSV</DropdownMenuItem>}
          {result && <DropdownMenuItem onSelect={exportJson}>Download JSON</DropdownMenuItem>}
          {result && edit && (
            <DropdownMenuItem onSelect={exportInserts}>Download SQL (INSERTs)</DropdownMenuItem>
          )}
          {edit && (
            <DropdownMenuItem onSelect={() => csvInputRef.current?.click()}>
              Import CSV…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {edit && (
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,.tsv,text/csv,text/tab-separated-values"
          hidden
          onChange={(e) => void onImportCsv(e)}
        />
      )}
    </>
  )
}
