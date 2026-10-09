import type {
  LspDocumentHighlight,
  LspInlayHint,
  LspColorInfo,
  LspCompletionItem,
  LspSignatureHelp,
} from './lsp-protocol'
import { toPosition, toRange } from './lsp-normalize-values'

/**
 * Normalize a `textDocument/documentHighlight` response (`DocumentHighlight[]`)
 * — each `{ range, kind? }` — into the editor-facing occurrence list. Entries
 * with a malformed range are dropped; `kind` is kept only when it is a valid
 * DocumentHighlightKind (1 Text, 2 Read, 3 Write).
 */
export function normalizeDocumentHighlights(res: unknown): LspDocumentHighlight[] {
  if (!Array.isArray(res)) return []
  const out: LspDocumentHighlight[] = []
  for (const raw of res) {
    const h = raw as { range?: unknown; kind?: unknown }
    const range = toRange(h.range)
    if (!range) continue
    const kind = h.kind === 1 || h.kind === 2 || h.kind === 3 ? h.kind : undefined
    out.push({ range, kind })
  }
  return out
}

/**
 * Normalize an LSP `textDocument/inlayHint` response into a flat hint list.
 * A hint's `label` may be a plain string OR an `InlayHintLabelPart[]` — the
 * parts are concatenated into one string. Hints without a valid position or a
 * non-empty label are dropped. `kind` is kept only for the known values (1/2).
 */
export function normalizeInlayHints(res: unknown): LspInlayHint[] {
  if (!Array.isArray(res)) return []
  const out: LspInlayHint[] = []
  for (const raw of res) {
    const h = raw as {
      position?: unknown
      label?: unknown
      kind?: unknown
      paddingLeft?: unknown
      paddingRight?: unknown
    }
    const position = toPosition(h.position)
    if (!position) continue
    let label = ''
    if (typeof h.label === 'string') label = h.label
    else if (Array.isArray(h.label)) {
      label = h.label
        .map((p) =>
          p && typeof (p as { value?: unknown }).value === 'string'
            ? (p as { value: string }).value
            : '',
        )
        .join('')
    }
    label = label.trim()
    if (!label) continue
    out.push({
      position,
      label,
      kind: h.kind === 1 || h.kind === 2 ? h.kind : undefined,
      paddingLeft: h.paddingLeft === true ? true : undefined,
      paddingRight: h.paddingRight === true ? true : undefined,
    })
  }
  return out
}

/**
 * Normalize an LSP `textDocument/documentColor` response into a flat color list.
 * Each entry carries a `range` (the literal's span) and a `color` whose channels
 * are clamped 0..1 floats. Entries without a valid range or numeric channels are
 * dropped so the editor never paints a bogus swatch.
 */
export function normalizeDocumentColors(res: unknown): LspColorInfo[] {
  if (!Array.isArray(res)) return []
  const out: LspColorInfo[] = []
  const clamp01 = (n: unknown): number | null => {
    const v = Number(n)
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null
  }
  for (const raw of res) {
    const c = raw as {
      range?: unknown
      color?: { red?: unknown; green?: unknown; blue?: unknown; alpha?: unknown } | null
    }
    const range = toRange(c.range)
    if (!range || !c.color) continue
    const red = clamp01(c.color.red)
    const green = clamp01(c.color.green)
    const blue = clamp01(c.color.blue)
    const alpha = clamp01(c.color.alpha)
    if (red === null || green === null || blue === null || alpha === null) continue
    out.push({ range, color: { red, green, blue, alpha } })
  }
  return out
}

/** Flatten an LSP hover/markup value (string | MarkedString | MarkupContent | array) to text. */
export function markupToText(input: unknown): string {
  if (input == null) return ''
  if (typeof input === 'string') return input
  if (Array.isArray(input)) return input.map(markupToText).filter(Boolean).join('\n\n')
  if (typeof input === 'object') {
    const obj = input as { value?: unknown; language?: unknown }
    if (typeof obj.value === 'string') {
      // A `{language, value}` MarkedString is a code block — fence it for the tooltip.
      return typeof obj.language === 'string' && obj.language
        ? `\`\`\`${obj.language}\n${obj.value}\n\`\`\``
        : obj.value
    }
  }
  return ''
}

/** Normalize an LSP `textDocument/completion` response (CompletionItem[] | CompletionList) to the thin editor-facing shape. */
export function normalizeCompletionItems(res: unknown): LspCompletionItem[] {
  const items = Array.isArray(res) ? res : ((res as { items?: unknown[] } | null)?.items ?? [])
  return (items as Record<string, unknown>[]).flatMap((item) => {
    const label = typeof item.label === 'string' ? item.label : ''
    if (!label) return []
    return [
      {
        label,
        detail: typeof item.detail === 'string' ? item.detail : undefined,
        kind: typeof item.kind === 'number' ? item.kind : undefined,
        insertText:
          (item.textEdit as { newText?: string } | undefined)?.newText ??
          (typeof item.insertText === 'string' ? item.insertText : undefined),
        documentation: markupToText(item.documentation).trim() || undefined,
      },
    ]
  })
}

/** Normalize an LSP SignatureHelp response to the thin editor-facing shape. */
export function normalizeSignatureHelp(res: unknown): LspSignatureHelp | null {
  const r = res as {
    signatures?: {
      label?: unknown
      documentation?: unknown
      parameters?: { label?: unknown }[]
    }[]
    activeSignature?: unknown
    activeParameter?: unknown
  } | null
  const sigs = Array.isArray(r?.signatures) ? r!.signatures : []
  if (sigs.length === 0) return null
  const signatures = sigs.map((s) => {
    const label = typeof s.label === 'string' ? s.label : ''
    const params = Array.isArray(s.parameters) ? s.parameters : []
    const parameters = params
      .map((p) => {
        if (typeof p.label === 'string') return p.label
        // A [start, end] tuple indexes into the signature label.
        if (Array.isArray(p.label) && label)
          return label.slice(Number(p.label[0]) || 0, Number(p.label[1]) || 0)
        return ''
      })
      .filter(Boolean)
    return { label, parameters, documentation: markupToText(s.documentation).trim() || undefined }
  })
  return {
    signatures,
    activeSignature: typeof r?.activeSignature === 'number' ? r.activeSignature : 0,
    activeParameter: typeof r?.activeParameter === 'number' ? r.activeParameter : 0,
  }
}
