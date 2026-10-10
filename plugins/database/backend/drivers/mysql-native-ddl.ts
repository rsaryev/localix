import { quoteIdent } from '../sql-ident'

export function mysqlTableCreateScript(
  row: Record<string, unknown> | undefined,
  schema: string,
  table: string,
): string | undefined {
  if (!row) return undefined
  const definition = Object.values(row).find(
    (value): value is string => typeof value === 'string' && /^\s*CREATE\s+TABLE\b/iu.test(value),
  )
  if (!definition) return undefined

  // SHOW CREATE uses the current table name but omits its schema. Replace only that
  // catalog-controlled header so a multi-object export remains unambiguous.
  const trimmed = definition.trim()
  const header = /^CREATE\s+TABLE\s+`(?:``|[^`])+`/iu.exec(trimmed)
  if (!header) return undefined
  return `CREATE TABLE ${quoteIdent(schema, 'mysql')}.${quoteIdent(table, 'mysql')}${trimmed.slice(header[0].length)}`
}

export function mysqlTriggerCreationContext(trigger: {
  SQL_MODE: string | null
  CHARACTER_SET_CLIENT: string | null
  COLLATION_CONNECTION: string | null
}): { pre: string[]; post: string[] } {
  const settings = [
    ['SQL_MODE', trigger.SQL_MODE],
    ['CHARACTER_SET_CLIENT', trigger.CHARACTER_SET_CLIENT],
    ['COLLATION_CONNECTION', trigger.COLLATION_CONNECTION],
  ] as const
  const pre: string[] = []
  const post: string[] = []
  for (const [variable, value] of settings) {
    // Catalog values use names/commas only. Fail closed rather than turning
    // corrupted metadata into executable text.
    if (typeof value !== 'string' || !/^[a-z0-9_,]*$/iu.test(value)) continue
    const saved = `@LOCALIX_TRIGGER_OLD_${variable}`
    pre.push(
      `SET ${saved} = @@SESSION.${variable}, @@SESSION.${variable} = '${value.replace(/'/gu, "''")}'`,
    )
    post.unshift(`SET @@SESSION.${variable} = ${saved}`)
  }
  return { pre, post }
}
