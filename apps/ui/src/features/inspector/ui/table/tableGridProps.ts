import type { SortSpec, TableColumn, TableRow } from '@localixai/dataview'
import type { PluginTableGridProps } from '@localixai/mini-app-sdk/ui'
import type { StagedChanges } from './useRowMutations'

export interface TableGridProps {
  columns: TableColumn[]
  rows: TableRow[]
  /** Total rows after filtering — drives the "showing N of M" gap. */
  total: number
  sort?: SortSpec
  onToggleSort: (columnId: string) => void
  /** Called as the scroll approaches the loaded tail, to append the next page. */
  onReachEnd: () => void
  /** Optional: make rows clickable (e.g. to open a row editor). Index into `rows`. */
  onRowActivate?: (index: number) => void
  /**
   * Opt-in editing seam. The grid stays DB-agnostic — it only EMITS edit intents;
   * it knows nothing about SQL. A consumer that leaves these unset (e.g. the
   * read-only spreadsheet Table tab) gets the current read-only grid.
   */
  editable?: boolean
  /**
   * Optional per-column edit gate. When omitted every column is editable; query-result
   * consumers pass only columns proven to map to physical source columns.
   */
  editableColumns?: Set<string>
  /**
   * Commit an in-place cell edit. `next` is the raw text the user typed, or `null`
   * for an explicit NULL. The consumer coerces by column type + builds the mutation.
   */
  onCellEdit?: (row: TableRow, columnId: string, next: string | null) => void
  /** Commit a new row. `values` is keyed by column id; blank = NULL (consumer decides). */
  onAddRow?: (values: Record<string, string | null>) => void
  /** Delete an existing row. */
  onDeleteRow?: (row: TableRow) => void
  /** Opt-in: show each column's cell type as a muted badge in the header (DB results). */
  showColumnTypes?: boolean
  showColumnIcons?: boolean
  showRowNumbers?: boolean
  showCellActions?: boolean
  allowNullValues?: boolean
  columnActions?: PluginTableGridProps['columnActions']
  /** Column ids that are part of the table's primary key — get a key glyph in the header. */
  pkColumns?: Set<string>
  /**
   * Per-column header filter. When wired, each header shows a funnel that opens a small
   * inline input; submitting calls this with the typed text. Falls back to `onCellFilter`
   * (equality) when unset. The DB console maps it to a server-side `col LIKE %value%`.
   */
  onColumnFilter?: (columnId: string, value: string) => void
  /** Column ids whose cells are foreign-key links (a hover ↗ opens the referenced row). */
  linkColumns?: Set<string>
  /** Invoked when a link cell's ↗ is clicked, with the column id + the cell value. */
  onCellLink?: (columnId: string, value: unknown) => void
  /** When set, cells get a right-click menu with "Filter by this value" (+ copy helpers). */
  onCellFilter?: (columnId: string, value: unknown) => void
  /** Staged-edit mode: when provided, cell edits AND row deletes accumulate as pending
   *  changes (dirty highlight / strike-through + a Commit/Discard bar) and are applied as
   *  ONE batch on Commit — instead of the immediate `onCellEdit` / `onDeleteRow` writes.
   *  Resolve false to keep the staged state (e.g. the batch failed). See useRowMutations. */
  onCommitChanges?: (changes: StagedChanges) => Promise<boolean>
  /**
   * An extra row-copy action appended to each data row's right-click menu (below "Copy
   * cell value" + "Copy row as JSON"). The owning feature supplies the label + a pure
   * `toText(columns,row)` builder, keeping this grid subsystem-agnostic — e.g. the
   * database console passes a "Copy row as INSERT" action. Absent → only the two generic
   * copy actions are offered (the read-only inspector Table tab, an ad-hoc query result).
   */
  extraRowCopy?: {
    label: string
    toText: (columns: TableColumn[], row: TableRow) => string
  }
}
