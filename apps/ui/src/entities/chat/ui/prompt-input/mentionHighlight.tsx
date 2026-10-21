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
import { avatarHue } from '@localixai/kit/avatar'

/**
 * A colleague's pill, in that colleague's own colour.
 *
 * THE COLOUR IS IN THE BACKGROUND, not the letters, and that is forced rather than chosen: the
 * real glyphs live in the textarea above this layer and are opaque, so anything this layer says
 * about text colour is never seen. A tinted ground under the opaque handle is the only way the
 * input can carry an identity at all, and it is the same hue the member's avatar and its name
 * in the transcript carry — one agent, one colour, wherever it appears.
 *
 * Built from the theme's own tile tokens rather than a colour of its own, so the pill follows a
 * theme switch without this file knowing either palette (see `monogram-avatar.tsx` for why the
 * value has to be composed here instead of read as one finished token).
 */
function agentPillStyle(handle: string): React.CSSProperties {
  return {
    '--avatar-hue': String(avatarHue(handle)),
    // A TINT, AND NO OUTLINE. The first version drew a 1px ring in the member's ink, and three
    // handles in a row became three boxed labels fighting the sentence around them — the input
    // is a place text is being written, not a list of tokens. The ground alone is enough to
    // tell one colleague from another, and it leaves the draft reading as a sentence.
    background: 'oklch(var(--avatar-tile-l) var(--avatar-tile-c) var(--avatar-hue) / 0.55)',
  } as React.CSSProperties
}

export function renderMentionHighlight(
  text: string,
  /** The party's handles; an agent token is pilled in its member's colour. */
  agentHandles: readonly string[] = [],
): ReactNode {
  return splitMentionSegments(text, agentHandles).map((seg, i) => {
    if (seg.type === 'agent') {
      return (
        <span
          key={i}
          className="rounded-sm box-decoration-clone"
          style={agentPillStyle(seg.handle)}
        >
          {seg.value}
        </span>
      )
    }
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
