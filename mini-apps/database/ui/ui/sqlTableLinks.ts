import type { MonacoEditorExtension } from '@localixai/kit/code-editor'
import { KEYWORDS } from '../model/format-sql/vocab'

const RELATION_KEYWORDS = new Set(['from', 'join', 'update', 'into', 'table'])

interface IdentifierSpan {
  start: number
  end: number
  name: string
  quoted: boolean
}

export interface SqlTableLinkTarget {
  start: number
  end: number
  name: string
}

function quotedIdentifier(sql: string, start: number, quote: '"' | '`' | '['): IdentifierSpan {
  const close = quote === '[' ? ']' : quote
  let cursor = start + 1
  while (cursor < sql.length) {
    if (sql[cursor] === close) {
      if (sql[cursor + 1] === close) {
        cursor += 2
        continue
      }
      cursor++
      break
    }
    cursor++
  }
  const raw = sql.slice(start + 1, Math.max(cursor - 1, start + 1))
  return {
    start,
    end: cursor,
    name: raw.replaceAll(close + close, close),
    quoted: true,
  }
}

/** SQL identifier spans outside comments and string literals. */
function identifierSpans(sql: string): IdentifierSpan[] {
  const spans: IdentifierSpan[] = []
  let cursor = 0
  while (cursor < sql.length) {
    const char = sql[cursor]
    if (char === '-' && sql[cursor + 1] === '-') {
      const newline = sql.indexOf('\n', cursor + 2)
      cursor = newline < 0 ? sql.length : newline + 1
      continue
    }
    if (char === '/' && sql[cursor + 1] === '*') {
      const close = sql.indexOf('*/', cursor + 2)
      cursor = close < 0 ? sql.length : close + 2
      continue
    }
    if (char === "'") {
      cursor++
      while (cursor < sql.length) {
        if (sql[cursor] !== "'") {
          cursor++
          continue
        }
        if (sql[cursor + 1] === "'") {
          cursor += 2
          continue
        }
        cursor++
        break
      }
      continue
    }
    if (char === '$') {
      const tag = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(cursor))?.[0]
      if (tag) {
        const close = sql.indexOf(tag, cursor + tag.length)
        cursor = close < 0 ? sql.length : close + tag.length
        continue
      }
    }
    if (char === '"' || char === '`' || char === '[') {
      const span = quotedIdentifier(sql, cursor, char)
      spans.push(span)
      cursor = span.end
      continue
    }
    if (char && /[A-Za-z_]/.test(char)) {
      let end = cursor + 1
      while (end < sql.length && /[A-Za-z0-9_$]/.test(sql[end]!)) end++
      spans.push({ start: cursor, end, name: sql.slice(cursor, end), quoted: false })
      cursor = end
      continue
    }
    cursor++
  }
  return spans
}

/**
 * Resolve linkable table identifiers. Known names stay linkable everywhere they are
 * used; relation positions are also retained while an asynchronously loaded schema
 * is still empty, and are validated again when the link is opened.
 */
export function sqlTableLinkTargets(
  sql: string,
  knownTables: ReadonlySet<string>,
): SqlTableLinkTarget[] {
  const targets = new Map<string, SqlTableLinkTarget>()
  let expectsRelation = false

  for (const span of identifierSpans(sql)) {
    const normalized = span.name.toLowerCase()
    if (!span.quoted && RELATION_KEYWORDS.has(normalized)) {
      expectsRelation = true
      continue
    }
    if (expectsRelation && !span.quoted && normalized === 'only') continue

    const known = knownTables.has(normalized)
    const relation = expectsRelation && (span.quoted || !KEYWORDS.has(span.name.toUpperCase()))
    if (known || relation) {
      targets.set(`${span.start}:${span.end}`, {
        start: span.start,
        end: span.end,
        name: span.name,
      })
    }
    expectsRelation = false
  }

  return [...targets.values()]
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/**
 * ⌘/Ctrl-hover and click navigation for SQL table references — underlined ONLY while the
 * modifier is held over the name, the way a definition link behaves in a code editor.
 *
 * The defect it replaces: these were registered as Monaco document LINKS, and Monaco draws every
 * link underlined all the time. Every known table in the buffer carried a permanent underline that
 * reads exactly like an error squiggle, so a table that existed looked like one that did not — and
 * the real "unknown table" squiggle drowned among them.
 */
export function sqlTableLinks(
  getTables: () => ReadonlySet<string>,
  onOpen: (table: string) => void,
): MonacoEditorExtension {
  return {
    setup({ monaco, editor, model }) {
      const hover = editor.createDecorationsCollection()
      const modifier = (event: { metaKey: boolean; ctrlKey: boolean }) =>
        IS_MAC ? event.metaKey : event.ctrlKey
      const targetAt = (position: { lineNumber: number; column: number } | null | undefined) => {
        if (!position) return null
        const offset = model.getOffsetAt(position)
        const tables = getTables()
        return (
          sqlTableLinkTargets(model.getValue(), tables).find(
            (target) =>
              offset >= target.start &&
              offset < target.end &&
              tables.has(target.name.toLowerCase()),
          ) ?? null
        )
      }
      const show = (target: SqlTableLinkTarget | null) => {
        if (!target) return hover.clear()
        const start = model.getPositionAt(target.start)
        const end = model.getPositionAt(target.end)
        hover.set([
          {
            range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
            options: {
              inlineClassName: 'localix-editor-link-active',
              hoverMessage: { value: `Open table \`${target.name}\`` },
            },
          },
        ])
      }
      let lastPosition: { lineNumber: number; column: number } | null = null
      const move = editor.onMouseMove((e) => {
        lastPosition = e.target.position ?? null
        show(modifier(e.event) ? targetAt(lastPosition) : null)
      })
      const leave = editor.onMouseLeave(() => {
        lastPosition = null
        hover.clear()
      })
      const keyDown = editor.onKeyDown((e) => {
        if (modifier(e)) show(targetAt(lastPosition))
      })
      const keyUp = editor.onKeyUp(() => hover.clear())
      const down = editor.onMouseDown((e) => {
        if (!modifier(e.event)) return
        const target = targetAt(e.target.position)
        if (!target) return
        e.event.preventDefault()
        onOpen(target.name)
        hover.clear()
      })
      return [move, leave, keyDown, keyUp, down, { dispose: () => hover.clear() }]
    },
  }
}
