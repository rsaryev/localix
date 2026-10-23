/**
 * Pure helpers behind the body editor — language mapping, JSON formatting, and `{{variable}}`
 * completions. Framework-free so the shared editor layer can adapt and unit-test them directly.
 */

import type { EditorCompletionItem } from '@localixai/kit/code-editor'

/** The editor grammar for a body mime type. Unknown types edit as plain text, never crash. */
export function editorLanguage(mimeType: string | undefined): string {
  const t = mimeType?.toLowerCase() ?? ''
  if (t.includes('json')) return 'json'
  if (t.includes('html')) return 'html'
  if (t.includes('xml')) return 'xml'
  return 'text'
}

/**
 * Pretty-print a JSON body (2-space indent), or return it unchanged when it does not parse.
 * Callers use this at load/save and response-display boundaries; invalid in-progress input must
 * remain exactly what the user typed so Monaco can point at the real syntax error.
 */
export function formatJsonBody(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** line/character (0-based) → offset into `text`. */
export function offsetAt(text: string, line: number, character: number): number {
  let offset = 0
  for (let i = 0; i < line; i++) {
    const nl = text.indexOf('\n', offset)
    if (nl === -1) return text.length
    offset = nl + 1
  }
  return Math.min(offset + character, text.length)
}

/**
 * `{{variable}}` completions for the cursor at `offset` — offered ONLY right after `{{`, so
 * ordinary JSON words don't drown in environment noise. The editor replaces the word the user
 * has typed (`[\w$]*`), which never includes the braces, so the insert text closes the template
 * but does not re-open it: `{{ba` + base_url → `{{base_url}}`.
 */
export function variableCompletions(
  text: string,
  offset: number,
  vars: ReadonlyArray<{ name: string; value: string; disabled?: boolean }>,
): EditorCompletionItem[] {
  const before = text.slice(0, offset)
  const wordStart = before.replace(/[\w$]*$/, '')
  if (!wordStart.endsWith('{{')) return []
  // Whatever already follows the cursor, closing braces included, stays untouched — a duplicate
  // `}}}}` reads as exactly what happened; an eaten one silently changes the request.
  const closed = text.slice(offset).trimStart().startsWith('}}')
  const completions: EditorCompletionItem[] = []
  for (const variable of vars) {
    if (variable.disabled) continue
    completions.push({
      label: variable.name,
      detail: variable.value,
      insertText: closed ? variable.name : `${variable.name}}}`,
      // 6 = LSP CompletionItemKind.Variable — the glyph the editor already renders for one.
      kind: 6,
    })
  }
  return completions
}
