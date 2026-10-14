// The completion's fixed SQL vocabulary: keyword/function/operator lists and the
// cursor-context regexes. No logic — shared by the analyzers and item builders.

// LSP CompletionItemKind subset (matches the editor's COMPLETION_KIND_TYPE map).
export const KIND_FIELD = 5
export const KIND_CLASS = 7
export const KIND_KEYWORD = 14
export const KIND_FUNCTION = 3
export const KIND_SNIPPET = 15

// Keywords that legally START a statement — the only sensible suggestions at a fresh
// statement start (before any clause is typed).
export const LEADING_KEYWORDS = [
  'SELECT',
  'INSERT INTO',
  'UPDATE',
  'DELETE FROM',
  'CREATE TABLE',
  'ALTER TABLE',
  'DROP TABLE',
  'WITH',
  'EXPLAIN',
]

// Clause/operator keywords that appear once a statement is underway.
const CLAUSE_KEYWORDS = [
  'FROM',
  'WHERE',
  'GROUP BY',
  'ORDER BY',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'INNER JOIN',
  'OUTER JOIN',
  'ON',
  'AS',
  'VALUES',
  'SET',
  'DISTINCT',
  'AND',
  'OR',
  'NOT',
  'NULL',
  'IS NULL',
  'IS NOT NULL',
  'IN',
  'LIKE',
  'BETWEEN',
  'ASC',
  'DESC',
  'UNION',
]

// Everything valid mid-statement (leading keywords still apply inside subqueries).
export const GENERAL_KEYWORDS = [...LEADING_KEYWORDS, ...CLAUSE_KEYWORDS]

// Aggregate/scalar functions offered alongside columns (dialect-agnostic common set).
export const SQL_FUNCTIONS = [
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'COALESCE',
  'LENGTH',
  'LOWER',
  'UPPER',
  'TRIM',
  'ROUND',
  'ABS',
  'CAST',
  'NOW',
]

// Comparison/predicate operators offered right after a completed column in WHERE/HAVING/ON.
export const PREDICATE_OPERATORS = [
  '=',
  '<>',
  '!=',
  '<',
  '>',
  '<=',
  '>=',
  'LIKE',
  'IN',
  'IS NULL',
  'IS NOT NULL',
  'BETWEEN',
  'AND',
  'OR',
]

// Words that, as the token just before the cursor, are NOT a column (so no operator follows).
export const KEYWORD_TOKEN =
  /^(where|having|on|and|or|not|order|by|group|select|from|join|set|as|in|like|is|between|values|distinct|left|right|inner|outer|union|asc|desc|limit|offset)$/

/** Keywords that, when they immediately precede the cursor token, mean a table follows. */
export const TABLE_CONTEXT = /\b(from|join|into|update|table)\s+("?[\w.]*)?$/i
/** `alias.` or `table.` immediately before the cursor → complete that table's columns. */
export const DOTTED = /("?[\w]+"?)\.\s*("?[\w]*)$/
