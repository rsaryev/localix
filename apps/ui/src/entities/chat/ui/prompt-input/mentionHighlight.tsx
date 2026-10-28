/**
 * renderMentionHighlight — paints the composer draft into a transparent mirror
 * layer BEHIND the textarea (see TextArea's `highlight` prop): each `@`-token
 * that classifies as a MENTION (a link-only `@path`, or a context-ref `@file:`/
 * `@folder:`/`@diff`/`@git:`) gets a pill-background span, the rest stays plain.
 *
 * The real, opaque text sits in the textarea on top, so this only paints a subtle
 * rounded background under each token — making `@file:…` and `@path` read as
 * parsed chips instead of raw text, with zero risk of double-drawn glyphs even if
 * metrics drift.
 *
 * Pure tokenization lives in `splitMentionSegments` (tested there); this file is
 * just the segment→node view.
 */
import { Fragment, type ReactNode } from 'react'
import { splitMentionSegments } from './mentionSegments'

export function renderMentionHighlight(text: string): ReactNode {
  return splitMentionSegments(text).map((seg, i) => {
    if (seg.type === 'mention') {
      // A bordered chip look so the token clearly reads as a linked reference,
      // not plain text. Drawn behind the (transparent) textarea glyphs.
      return (
        <span
          key={i}
          className="rounded-sm bg-foreground/[0.07] ring-1 ring-inset ring-foreground/20 box-decoration-clone"
        >
          {seg.value}
        </span>
      )
    }
    return <Fragment key={i}>{seg.value}</Fragment>
  })
}
