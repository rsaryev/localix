import { useEffect, useMemo } from 'react'
import type { TableRow } from '@localixai/dataview'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { snippetMessageBindingDraft } from '@localixai/mini-app-sdk/ui'
import { formatResultSnippet } from './resultSnippet'

/**
 * A table tab's live facet: the page of rows on screen, with the page and filter that produced it
 * — or the error the read raised instead.
 *
 * The tab's static binding already names the table, and the resolver expands its schema; what the
 * agent could not see is WHICH rows the user is looking at ("why is `email` empty here?" is about
 * this page under this filter, not about the table in general).
 */
export function useTableViewContext(input: {
  publishMessageContext?: PublishMessageContext
  table: string
  connection: string
  columns: ReadonlyArray<{ id: string; title: string }> | undefined
  rows: readonly TableRow[]
  page: number
  pageSize: number
  filter: string
  error: string | null
}): void {
  const { publishMessageContext, table, connection, columns, rows, page, pageSize, filter, error } =
    input
  const content = useMemo(() => {
    const where = `${connection} · ${table} · page ${page + 1} (rows ${page * pageSize + 1}–${page * pageSize + rows.length})`
    const filtered = filter.trim() ? `\nFilter: ${filter.trim()}` : ''
    if (error) return `${where}${filtered}\n\nThe read failed: ${error}`
    if (!columns) return null
    return `${where}${filtered}\n\n${formatResultSnippet(columns, rows)}`
  }, [columns, connection, error, filter, page, pageSize, rows, table])

  useEffect(() => {
    if (!publishMessageContext) return
    if (!content) {
      publishMessageContext(null)
      return
    }
    publishMessageContext({
      strategy: 'append',
      bindings: [
        snippetMessageBindingDraft({ label: `${table} — visible rows`, content, language: 'text' }),
      ],
    })
  }, [content, publishMessageContext, table])
}
