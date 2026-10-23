import type { DbDialect } from '../../dbClient'
import { compileSql, describeParams, typeParamValue } from '../sqlParams'

/**
 * Compile every placeholder spelling owned by the driver manifest into its adapter
 * binding + an ordered params array. Values are typed (NULL / number / string) via
 * typeParamValue. No-op when the dialect is unset or the statement has no parameters.
 */
export function compileRunStatement(
  trimmed: string,
  dialect: DbDialect | undefined,
  paramValues: Record<string, string>,
): { text: string; params: unknown[] | undefined } {
  const desc = dialect ? describeParams(trimmed, dialect) : { any: false, fields: [] }
  if (!dialect || !desc.any) return { text: trimmed, params: undefined }
  const values = Object.fromEntries(
    desc.fields.map((field) => [field.key, typeParamValue(paramValues[field.key] ?? '')]),
  )
  const compiled = compileSql(trimmed, dialect, values)
  return { text: compiled.text, params: compiled.params }
}
