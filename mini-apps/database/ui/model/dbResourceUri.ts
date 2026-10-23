import { localixResourceUri } from '@localixai/mini-app-sdk/navigation'

/** Resource URI for a database entity, matching the database provider grammar
 *  (`localix://resource/db/<connId>/_/<schema>/<table>[/<column>]`; `_` = reserved db segment).
 *  Each NAME segment is percent-encoded: the `@resource:` token grammar is
 *  whitespace-delimited and the provider splits positionally on `/`, so a table
 *  named `my table` or `orders(archive)` would otherwise break the token / shift
 *  segments (the backend guard-decodes each segment). */
export function dbResourceUri(
  connId: string,
  schema: string,
  table: string,
  column?: string,
): string {
  return localixResourceUri('db', [connId, '_', schema, table, ...(column ? [column] : [])])
}

export const dbConnectionResourceUri = (connId: string): string =>
  localixResourceUri('db', [connId])
