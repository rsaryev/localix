import type { EditorCompletionItem, EditorPosition } from '@localixai/kit/code-editor'

/**
 * Method autocomplete for the document/search consoles: detect an in-progress method name
 * typed after `<collection>.` / `db.<collection>.` / `<index>.` at the caret, and match it
 * against the engine's method list. Pure + testable; the console renders the dropdown.
 */

/** A `<name>.<partial>` method context at the caret: the partial being typed + where it starts. */
export interface MethodContext {
  partial: string
  /** Index in the source text where the partial begins (for replacement). */
  start: number
}

// `<name>.<partial>` at the very end, where <name> is a collection/index (optionally db-prefixed)
// and <partial> is an in-progress identifier (no `(` yet). Preceded by start/whitespace/bracket
// so it doesn't fire mid-token.
const METHOD_RE = /(?:^|[\s;([{,])((?:db\.)?[A-Za-z0-9_$-]+)\.([A-Za-z]*)$/

/** The method-completion context for `textBeforeCaret`, or null when not after `<name>.`. */
export function methodContextBeforeCaret(textBeforeCaret: string): MethodContext | null {
  const m = METHOD_RE.exec(textBeforeCaret)
  if (!m) return null
  // A bare `db` name is the `db.<collection>` prefix — the user is still typing the collection
  // (e.g. `db.users`), not a method, so don't offer method completions yet.
  if (m[1] === 'db') return null
  const partial = m[2] ?? ''
  return { partial, start: textBeforeCaret.length - partial.length }
}

/** Methods/names whose value starts with `partial` (case-insensitive), capped. Empty → all. */
export function matchMethods(methods: string[], partial: string, limit = 8): string[] {
  const p = partial.toLowerCase()
  return methods.filter((m) => m.toLowerCase().startsWith(p)).slice(0, limit)
}

/**
 * The call template inserted after a chosen method name: `body` is what follows the name
 * (starting at `(`), `caret` is the cursor offset within `body` (so the caret lands inside the
 * braces / quotes ready to type args). Falls back to a bare `(` for unknown methods.
 */
export function methodCallSnippet(method: string): { body: string; caret: number } {
  switch (method) {
    case 'aggregate':
      return { body: '([  ])', caret: 3 } // ([ | ])
    case 'distinct':
    case 'get':
      return { body: '("")', caret: 2 } // ("|")
    case 'find':
    case 'findOne':
    case 'count':
    case 'countDocuments':
    case 'search':
      return { body: '({  })', caret: 3 } // ({ | })
    default:
      return { body: '(', caret: 1 }
  }
}

// The in-progress collection/index identifier at the caret — after an optional `db.` prefix,
// with no method dot / arguments yet. Only chars valid in a collection/index name.
const NAME_BODY_RE = /^[A-Za-z0-9_$*-]*$/

/**
 * The collection/index NAME-completion context for `textBeforeCaret`, or null when the caret
 * isn't inside an in-progress name (e.g. already past the method dot or into arguments).
 * Strips a leading `db.` (Mongo convention) so the returned `start` points at the name itself.
 */
export function nameContextBeforeCaret(textBeforeCaret: string): MethodContext | null {
  const leadWs = textBeforeCaret.length - textBeforeCaret.trimStart().length
  let body = textBeforeCaret.slice(leadWs)
  let base = leadWs
  if (body.startsWith('db.')) {
    body = body.slice(3)
    base += 3
  }
  if (!NAME_BODY_RE.test(body)) return null
  return { partial: body, start: base }
}

function offsetAtPosition(text: string, position: EditorPosition): number {
  let offset = 0
  for (let line = 0; line < position.line; line += 1) {
    const newline = text.indexOf('\n', offset)
    if (newline < 0) return text.length
    offset = newline + 1
  }
  const lineEnd = text.indexOf('\n', offset)
  return Math.min(offset + position.character, lineEnd < 0 ? text.length : lineEnd)
}

function positionAtOffset(text: string, rawOffset: number): EditorPosition {
  const offset = Math.min(Math.max(rawOffset, 0), text.length)
  let line = 0
  let lineStart = 0
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1
      lineStart = index + 1
    }
  }
  return { line, character: offset - lineStart }
}

function snippetWithFinalCaret(method: string): string {
  const template = methodCallSnippet(method)
  return `${method}${template.body.slice(0, template.caret)}$0${template.body.slice(template.caret)}`
}

/**
 * Native-editor completion items for MongoDB/Elasticsearch command buffers. The explicit
 * range is important: Monaco's default word range doesn't include `$`/`-` consistently and
 * would otherwise leave part of an in-progress collection or method behind.
 */
export function docCompletionItems(
  text: string,
  position: EditorPosition,
  methods: string[],
  collections: string[],
): EditorCompletionItem[] {
  const caret = offsetAtPosition(text, position)
  const before = text.slice(0, caret)
  const methodContext = methodContextBeforeCaret(before)
  const nameContext = methodContext ? null : nameContextBeforeCaret(before)
  const dbPrefixed = /^\s*db\./.test(before)
  const context = methodContext ?? nameContext
  if (!context) return []

  const names = methodContext
    ? matchMethods(methods, methodContext.partial)
    : nameContext && (nameContext.partial.length > 0 || dbPrefixed)
      ? matchMethods(collections, nameContext.partial)
      : []
  const range = {
    start: positionAtOffset(text, context.start),
    end: positionAtOffset(text, caret),
  }

  return names.map((name, index) =>
    methodContext
      ? {
          label: name,
          detail: 'method',
          kind: 2,
          insertText: snippetWithFinalCaret(name),
          insertTextFormat: 'snippet',
          range,
          filterText: name,
          sortText: String(index).padStart(4, '0'),
          preselect: index === 0,
        }
      : {
          label: name,
          detail: 'collection / index',
          kind: 9,
          insertText: `${name}.`,
          insertTextFormat: 'plainText',
          range,
          filterText: name,
          sortText: String(index).padStart(4, '0'),
          preselect: index === 0,
          command: {
            id: 'editor.action.triggerSuggest',
            title: 'Trigger suggestions',
          },
        },
  )
}
