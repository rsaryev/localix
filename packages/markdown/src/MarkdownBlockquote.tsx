import type { ComponentPropsWithoutRef } from 'react'
import {
  Info,
  Lightbulb,
  MessageSquareWarning,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { CALLOUT_KINDS, type CalloutKind } from './dialect'

type MarkdownBlockquoteProps = ComponentPropsWithoutRef<'blockquote'> & {
  node?: unknown
  'data-callout'?: string
  'data-callout-title'?: string
}

// A Record over the leaf's kinds, so a kind added there fails `tsc` here until it has a look.
const CALLOUT_LOOK: Record<CalloutKind, { icon: LucideIcon; label: string }> = {
  note: { icon: Info, label: 'Note' },
  tip: { icon: Lightbulb, label: 'Tip' },
  important: { icon: MessageSquareWarning, label: 'Important' },
  warning: { icon: TriangleAlert, label: 'Warning' },
  caution: { icon: OctagonAlert, label: 'Caution' },
}

function calloutKind(value: string | undefined): CalloutKind | null {
  return value && (CALLOUT_KINDS as readonly string[]).includes(value)
    ? (value as CalloutKind)
    : null
}

/**
 * A quote, or — when `remarkAnswerBlocks` marked it — a typed callout. An `aside` with
 * `role="note"` rather than a styled quote: a warning is not a quotation, and assistive tech
 * should announce it as the aside it is, with its kind as the first thing read.
 *
 * The kind is carried by the glyph alone, in its status colour: the app paints status on a
 * glyph and never as a wash (`status-tone.ts`), and a coloured band per note turned a reply
 * with a few of them into a stack of banners. The kind's name is spoken, not printed — an
 * English "Warning" over a Russian sentence was the other thing that read as foreign. A title
 * is printed only when the author wrote one (`> [!TIP] Faster builds`).
 */
export function MarkdownBlockquote({
  children,
  node: _node,
  'data-callout': callout,
  'data-callout-title': title,
  ...quoteProps
}: MarkdownBlockquoteProps) {
  const kind = calloutKind(callout)
  if (!kind) return <blockquote {...quoteProps}>{children}</blockquote>
  const { icon: Icon, label } = CALLOUT_LOOK[kind]
  return (
    <aside className="lx-callout" data-callout={kind} role="note" aria-label={title || label}>
      <Icon aria-hidden className="lx-callout-icon" strokeWidth={1.75} />
      <div className="lx-callout-body">
        {title && <div className="lx-callout-title">{title}</div>}
        {children}
      </div>
    </aside>
  )
}
