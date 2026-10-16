/** Small SQL text helpers shared by the DDL generators (backend) and the alter-table models (UI). */

/** Trim and drop any trailing `;` terminators, so a caller can append exactly one. */
export function stripStatementTerminator(script: string): string {
  return script.trim().replace(/;+\s*$/u, '')
}

/** A standard single-quoted SQL string literal: quotes doubled, nothing else escaped. */
export function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
