/**
 * Host-side payload builder — PURE (no DOM), so the UI bundle can import it freely.
 * Turns picked-element captures + notes into ONE clean **Markdown** message: a header,
 * then per element the user's comment (as a blockquote) and the technical pointers
 * (source, component, position, …) as a bullet list. Markdown so the existing chat
 * renderer shows it nicely with NO special-casing — the chat layer knows nothing about
 * "comments". Neutral framing only: we present pointers + comments + screenshots and
 * let the agent decide what to do.
 */

import type { VfCapture } from '../protocol/index'
import { clampCapture, redactSecrets, sanitizeUrl } from '../core/redact'

export interface VfComment {
  capture: VfCapture
  note: string
}

/** The note as a Markdown blockquote (every line prefixed, so multi-line stays quoted). */
function blockquote(note: string): string {
  return note
    .trim()
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')
}

function sourceLine(c: VfCapture): string | undefined {
  const s = c.source
  if (!s?.file) return undefined
  let out = s.file
  if (s.line) out += `:${s.line}`
  if (s.column != null) out += `:${s.column}`
  if (s.component) out += ` (<${s.component}>)`
  return `\`${out}\` _[${s.method}/${s.confidence}]_`
}

/**
 * @param comments  picked elements + notes
 * @param servedFile the file the preview is serving (fallback source anchor)
 * @param url        the preview URL (context)
 * @param viewport   preview viewport size — makes each element's rect interpretable
 *                   (e.g. "is x:900 near the right edge?"), key for responsive feedback
 */
export function buildPreviewCommentsMessage(
  comments: VfComment[],
  opts: { servedFile?: string; url?: string; viewport?: { width: number; height: number } } = {},
): string {
  const vp =
    opts.viewport && opts.viewport.width > 0 && opts.viewport.height > 0
      ? `viewport ${Math.round(opts.viewport.width)}×${Math.round(opts.viewport.height)}`
      : ''
  // Strip query/hash + redact before showing the URL — it often carries auth tokens.
  const safeUrl = redactSecrets(sanitizeUrl(opts.url))
  const ctx = [safeUrl ? `\`${safeUrl}\`` : '', vp].filter(Boolean).join(' · ')

  const out: string[] = []
  out.push(`**Preview feedback**${ctx ? ` — ${ctx}` : ''}`)
  out.push('')
  out.push('The user reviewed the live preview and left comments on these elements:')

  comments.forEach(({ capture: rawCapture, note }, i) => {
    // Re-clamp host-side: the authoritative redaction pass, independent of the
    // probe version that produced the capture (idempotent — safe to re-run).
    const c = clampCapture(rawCapture)
    out.push('')
    out.push(`**${i + 1}. ${c.summary}**`)
    out.push('')
    out.push(blockquote(note))
    out.push('')

    // Technical pointers as a bullet list — identity first, weak selector last. The
    // agent reads these and decides; we don't prescribe an action.
    const pts: string[] = []
    if (c.componentPath) pts.push(`component: \`${c.componentPath}\``)
    const src = sourceLine(c)
    if (src) pts.push(`source: ${src}`)
    else if (opts.servedFile)
      pts.push(`source: \`${opts.servedFile}\` _(served file; not resolved to a line)_`)
    if (c.text) pts.push(`text: "${c.text.length > 160 ? `${c.text.slice(0, 160)}…` : c.text}"`)
    if (c.html) pts.push(`html: \`${c.html}\``)
    if (c.role) pts.push(`role: ${c.role}`)
    if (c.selector) pts.push(`selector: \`${c.selector}\``)
    if (c.domPath) pts.push(`path: \`${c.domPath}\``)
    if (c.rect && (c.rect.width || c.rect.height)) {
      const r = c.rect
      pts.push(
        `position: x:${Math.round(r.x)}, y:${Math.round(r.y)} · ${Math.round(r.width)}×${Math.round(r.height)}px`,
      )
    }
    if (c.computedStyle) pts.push(`style: ${c.computedStyle}`)
    if (c.kind !== 'element') {
      pts.push(`kind: ${c.kind}${c.members?.length ? ` (${c.members.length} elements)` : ''}`)
      if (c.members?.length) pts.push(`members: ${c.members.slice(0, 12).join(' | ')}`)
    }
    for (const p of pts) out.push(`- ${p}`)
  })

  return out.join('\n').trim()
}
