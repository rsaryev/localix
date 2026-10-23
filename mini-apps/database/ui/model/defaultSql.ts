import type { EditorCompletionItem } from '@localixai/kit/code-editor'
import {
  getDatabaseDriverManifest,
  type DatabaseDefaultExpression,
  type DatabaseSchemaTypeFamily,
} from '../../shared/driver-catalog'
import type { DbDialect } from '../dbClient'
import { tokenize } from './format-sql/tokenize'

const KIND_FUNCTION = 3
const KIND_VALUE = 12
const KIND_KEYWORD = 14

export interface DefaultSqlPreset {
  label: string
  value: string
  detail: string
  kind: number
}

const COMPLETION_KIND = {
  value: KIND_VALUE,
  keyword: KIND_KEYWORD,
  function: KIND_FUNCTION,
} satisfies Record<DatabaseDefaultExpression['kind'], number>

function typeFamilies(dataType: string): Set<DatabaseSchemaTypeFamily> {
  const type = dataType.toLowerCase()
  const families = new Set<DatabaseSchemaTypeFamily>()
  if (/bool|bit/.test(type)) families.add('boolean')
  if (/date|time/.test(type)) families.add('temporal')
  if (/uuid|uniqueidentifier/.test(type)) families.add('uuid')
  if (/char|text|string/.test(type)) families.add('text')
  if (/int|real|float|double|decimal|numeric/.test(type)) families.add('numeric')
  if (/json/.test(type)) families.add('json')
  return families
}

function dataTypeRank(
  expression: DatabaseDefaultExpression,
  families: Set<DatabaseSchemaTypeFamily>,
): number {
  return expression.appliesTo?.some((family) => families.has(family)) ? 0 : 1
}

/** Dialect-correct quick values, ordered for the selected column's data type. */
export function defaultSqlPresets(dialect: DbDialect, dataType: string): DefaultSqlPreset[] {
  const families = typeFamilies(dataType)
  return [...getDatabaseDriverManifest(dialect).schemaDefaultExpressions]
    .sort((left, right) => dataTypeRank(left, families) - dataTypeRank(right, families))
    .map((item) => ({
      label: item.value,
      value: item.value,
      detail: item.detail,
      kind: COMPLETION_KIND[item.kind],
    }))
}

/**
 * DEFAULT expressions deliberately use their own completion vocabulary. Reusing the
 * console's schema completion would suggest tables/columns, which most engines reject
 * inside a column default.
 */
export function defaultSqlCompletions(
  dialect: DbDialect,
  dataType: string,
): EditorCompletionItem[] {
  return defaultSqlPresets(dialect, dataType).map((item, index) => ({
    label: item.label,
    detail: item.detail,
    documentation: `Insert ${item.value} as the column's DEFAULT expression.`,
    kind: item.kind,
    insertText: item.value,
    filterText: `${item.label} ${item.detail}`,
    sortText: String(index).padStart(3, '0'),
  }))
}

/** Error that would make `DEFAULT <expression>` ambiguous or unsafe to generate. */
export function validateDefaultSqlExpression(value: string): string | null {
  if (!value.trim()) return null
  const tokens = tokenize(value)
  const first = tokens.find((token) => token.kind !== 'comment')
  if (first?.kind === 'word' && first.text.toUpperCase() === 'DEFAULT')
    return 'Enter the expression only; DEFAULT is added automatically.'
  if (tokens.some((token) => token.kind === 'punct' && token.text === ';'))
    return 'Use one expression without a trailing semicolon.'
  for (const token of tokens) {
    if (token.kind !== 'string') continue
    const quote = token.text[0]
    if ((quote === "'" || quote === '"' || quote === '`') && !token.text.endsWith(quote))
      return `A ${quote} quoted value is not closed.`
    if (quote === '[' && !token.text.endsWith(']')) return 'A [ quoted identifier is not closed.'
    if (quote === '$') {
      const tag = /^\$[A-Za-z_0-9]*\$/.exec(token.text)?.[0]
      if (tag && token.text.lastIndexOf(tag) === 0) return `The ${tag} quoted value is not closed.`
    }
  }

  let depth = 0
  for (const token of tokens) {
    if (token.text === '(') depth++
    if (token.text === ')') depth--
    if (depth < 0) return 'Closing parenthesis has no matching opening parenthesis.'
  }
  if (depth > 0) return 'An opening parenthesis is not closed.'
  return null
}
