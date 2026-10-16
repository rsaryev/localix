import type { EditorDiagnostic } from '@/shared/ui/code-editor/CodeEditor'
import type { EditorDiagnosticTag } from '@/shared/ui/code-editor/types'
import type { Comment } from '@localixai/plugin-sdk/ui/comments'
import type { LspDiagnostic } from '@/shared/api/contracts'
import { languageFromPath } from '@/shared/ui/diff'

const LSP_SEVERITY: Record<number, EditorDiagnostic['severity']> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'hint',
}

/** True when the path is a markdown-family file (md/markdown/mdx). */
export const isMarkdown = (path: string) => /\.(md|markdown|mdx)$/i.test(path)

/** True when the path is an HTML file — offered a live preview from the editor toolbar. */
export const isHtml = (path: string) => /\.html?$/i.test(path)

/**
 * Persist a dirty editor before an action whose consumer reads the workspace
 * from disk. A failed save is an explicit gate: callers must not enqueue a fix,
 * submit comments, or hand a batch to a comment action against stale bytes.
 */
export async function saveBeforeFileAction(
  dirty: boolean,
  save: () => boolean | Promise<boolean>,
): Promise<boolean> {
  return dirty ? await save() : true
}

/**
 * Render an accumulated comment batch into a markdown body plus the unique file
 * list. Shared by "Send to agent" (the prompt) and every contributed comment
 * action (the batch's `summary` + `files`).
 *
 * Like the editor's "References" peek: each row is a clickable `[file:line](href)`
 * link (the card's MarkdownRenderer turns file hrefs into inspector jumps) + the note,
 * followed by the full code line in a fenced block → syntax-highlighted by CodeBlock.
 */
export function buildCommentsPayload(comments: Comment[]): {
  summary: string
  files: string[]
} {
  const rows = comments.map((c) => {
    const fileLabel = c.anchor.groupLabel ?? c.anchor.targetId.split('/').pop() ?? c.anchor.targetId
    const line = Number(c.anchor.locator?.line ?? 0) + 1
    const ref = `[${fileLabel}:${line}](${c.anchor.targetId}#L${line})`
    const note = c.body.trim() ? ` — ${c.body.trim()}` : ''
    const code = c.anchor.context
      ? `\n\n\`\`\`${languageFromPath(c.anchor.targetId)}\n${c.anchor.context}\n\`\`\``
      : ''
    return `${ref}${note}${code}`
  })
  const files = [...new Set(comments.map((c) => c.anchor.targetId))]
  return { summary: rows.join('\n\n'), files }
}

/** LSP `DiagnosticTag` → how the editor draws the span (faded / struck through). */
const LSP_TAG: Record<number, EditorDiagnosticTag> = {
  1: 'unnecessary',
  2: 'deprecated',
}

/** LSP diagnostic (0-based ranges, 1–4 severity, tags) → editor-primitive shape. */
export function toEditorDiagnostic(d: LspDiagnostic): EditorDiagnostic {
  const tags = d.tags?.flatMap((tag) => LSP_TAG[tag] ?? [])
  return {
    line: d.range.start.line,
    character: d.range.start.character,
    endLine: d.range.end.line,
    endCharacter: d.range.end.character,
    severity: LSP_SEVERITY[d.severity ?? 1] ?? 'error',
    message: d.message,
    source: d.source,
    code: d.code,
    ...(tags?.length ? { tags } : {}),
  }
}
