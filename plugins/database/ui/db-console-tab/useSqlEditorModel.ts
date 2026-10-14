import { useCallback, useMemo } from 'react'
import type { CompletionSource } from '@localixai/kit/code-editor'
import type { useSchema } from '../model/useSchema'
import { offsetAt, sqlCompletions } from '../model/sqlCompletion'

/**
 * Schema-aware SQL autocomplete + editor-highlight vocabulary: reads the live editor
 * text + schema model, independent of the editor runtime — reuses the generic
 * completionSource slot.
 */
export function useSqlEditorModel(schema: ReturnType<typeof useSchema>, getText: () => string) {
  const model = schema.model
  // Lower-cased table-name set for ⌘/Ctrl-click-to-open links in the SQL editor.
  const tableNameSet = useMemo(
    () => new Set(model.tables.map((t) => t.toLowerCase())),
    [model.tables],
  )
  // Lower-cased set of all known column names (across loaded tables), for the subtle
  // column-reference tint in the editor.
  const columnNameSet = useMemo(
    () =>
      new Set(
        Object.values(model.columnsByTable)
          .flat()
          .map((c) => c.toLowerCase()),
      ),
    [model.columnsByTable],
  )
  const completionSource = useCallback<CompletionSource>(
    async (pos) => {
      const text = getText()
      return sqlCompletions(text, offsetAt(text, pos.line, pos.character), model)
    },
    [getText, model],
  )
  return { tableNameSet, columnNameSet, completionSource }
}
