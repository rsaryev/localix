/** A database object's DDL view: the engine's CREATE (or one reconstructed from live metadata),
 * formatted once and used for reading, copying and opening in a console. */
import { ArrowUpRight, Check, Copy, FileCode2 } from 'lucide-react'
import type { MiniAppProblemLineProps } from '@localixai/mini-app-sdk/ui/components'
import { useCopied } from '@localixai/mini-app-sdk/ui/interactions'
import { Button } from '@localixai/kit/button'
import { CodeEditor } from '@localixai/kit/code-editor'
import { Spinner } from '@localixai/kit/spinner'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import type { DbConnectionInfo } from '../../dbClient'
import { buildTableDDL } from '../../model/schemaDDL'
import { formatSql } from '../../model/formatSql'
import type { SchemaState } from '../../model/useSchema'
import { ObjectErrorState } from '../ObjectErrorState'
import type { DatabaseObjectTarget } from './target'

export function DdlView({
  connection,
  target,
  schema,
  readProblem,
  onOpenConsoleWithSql,
}: {
  connection: DbConnectionInfo
  target: DatabaseObjectTarget
  schema: SchemaState
  readProblem: MiniAppProblemLineProps | null
  onOpenConsoleWithSql: (sql: string) => void
}) {
  // The button's own tick confirms the copy; a copy is not an Event Center fact.
  const { copied, copy } = useCopied()
  const table = schema.getTable(target.table, target.schema)
  if (!table) {
    if (readProblem) return <ObjectErrorState problem={readProblem} />
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-text-faint">
        <Spinner className="size-3.5" />
        Reading DDL…
      </div>
    )
  }
  // Engines (notably SQLite) often expose the original CREATE as one compact line.
  // Keep one formatted value for reading, copying, and opening in the console.
  const ddl = formatSql(buildTableDDL(table, connection.dialect))
  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkbenchToolbar aria-label="DDL controls">
        <WorkbenchToolbarSection className="flex-1">
          <FileCode2 className="size-3.5 shrink-0 text-text-faint" />
          <span className="min-w-0 flex-1 truncate text-2xs text-text-faint">
            {table.createScript ? 'Engine DDL' : 'Reconstructed from live metadata'}
          </span>
        </WorkbenchToolbarSection>
        <WorkbenchToolbarSection align="end">
          <Button size="xs" variant="ghost" onClick={() => void copy(ddl)}>
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => onOpenConsoleWithSql(ddl)}>
            <ArrowUpRight className="size-3" />
            Open in console
          </Button>
        </WorkbenchToolbarSection>
      </WorkbenchToolbar>
      <CodeEditor
        value={ddl}
        language="sql"
        readOnly
        ariaLabel={`DDL for ${target.table}`}
        className="min-h-0 flex-1"
      />
    </div>
  )
}
