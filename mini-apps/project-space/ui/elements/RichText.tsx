import type { ReactNode } from 'react'
import { Checkbox } from '@localixai/kit/checkbox'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import {
  parseInline,
  parseRichText,
  type InlineMark,
  type InlineSpan,
  type RichBlock,
} from '../../shared/content/rich-text'
import { LinkedText } from './WebLink'

/**
 * A note's or a shape label's text, drawn with its marks (`shared/content/rich-text.ts`). The
 * text stays plain in the file; this only paints it. Web addresses inside any span stay the
 * board's interactive links, and a task box is a real checkbox whose tick is an edit of the
 * text — one undo step, like a ticked box in a Markdown text element.
 */
const MARK_TAG: Record<InlineMark, (children: ReactNode, key: number) => ReactNode> = {
  bold: (children, key) => (
    <strong key={key} className="font-semibold">
      {children}
    </strong>
  ),
  italic: (children, key) => <em key={key}>{children}</em>,
  underline: (children, key) => (
    <u key={key} className="underline-offset-2">
      {children}
    </u>
  ),
  strike: (children, key) => (
    <s key={key} className="decoration-current/70">
      {children}
    </s>
  ),
  highlight: (children, key) => (
    <mark key={key} className="space-mark">
      {children}
    </mark>
  ),
  code: (children, key) => (
    <code key={key} className="space-code">
      {children}
    </code>
  ),
}

function Spans({ spans }: { spans: readonly InlineSpan[] }) {
  return spans.map((span, index) =>
    // Innermost mark first, so `**_x_**` is <strong><em>x</em></strong>.
    [...span.marks]
      .reverse()
      .reduce<ReactNode>(
        (children, mark) => MARK_TAG[mark](children, index),
        span.marks.includes('code') ? span.text : <LinkedText key={index} text={span.text} />,
      ),
  )
}

/** One line of marks with its breaks: a shape label, where lists have no room. */
export function InlineRichText({ text }: { text: string }) {
  return text.split('\n').map((line, index) => (
    <span key={index} className="block min-h-[1lh]">
      <Spans spans={parseInline(line)} />
    </span>
  ))
}

const INDENT = [
  '',
  'pl-[1.25em]',
  'pl-[2.5em]',
  'pl-[3.75em]',
  'pl-[5em]',
  'pl-[6.25em]',
  'pl-[7.5em]',
]

export function RichText({
  text,
  onToggleTask,
}: {
  text: string
  /** A task box was ticked or cleared; absent draws the boxes read-only. */
  onToggleTask?: (line: number) => void
}) {
  return (
    <div className="flex flex-col">
      {parseRichText(text).map((block, index) => (
        <Block key={index} block={block} onToggleTask={onToggleTask} />
      ))}
    </div>
  )
}

function Block({
  block,
  onToggleTask,
}: {
  block: RichBlock
  onToggleTask?: (line: number) => void
}) {
  switch (block.kind) {
    case 'blank':
      return <span aria-hidden className="block h-[1lh]" />
    case 'paragraph':
      return (
        <p>
          <Spans spans={block.spans} />
        </p>
      )
    case 'heading':
      return (
        <p
          role="heading"
          aria-level={block.level}
          className={cn(
            'font-semibold tracking-tight',
            block.level === 1 ? 'text-[1.4em] leading-tight' : block.level === 2 && 'text-[1.2em]',
          )}
        >
          <Spans spans={block.spans} />
        </p>
      )
    case 'quote':
      return (
        <p className="space-quote">
          <Spans spans={block.spans} />
        </p>
      )
    case 'bullet':
    case 'number':
      return (
        <p className={cn('flex gap-[0.45em]', INDENT[block.depth])}>
          <span aria-hidden className="shrink-0 text-[0.9em] opacity-70 tabular-nums">
            {block.kind === 'number' ? block.number : block.depth % 2 ? '◦' : '•'}
          </span>
          <span className="min-w-0">
            <Spans spans={block.spans} />
          </span>
        </p>
      )
    case 'task':
      return (
        // Only the box ticks: the row is no <label>, so a click on the words selects the note,
        // as it does anywhere else on it, instead of ticking the task under the pointer.
        <div className={cn('flex items-start gap-[0.45em]', INDENT[block.depth])}>
          <Checkbox
            aria-label={block.spans.map((span) => span.text).join('')}
            checked={block.checked}
            disabled={!onToggleTask}
            onChange={() => onToggleTask?.(block.line)}
            className="space-task-box nodrag"
          />
          <span className={cn('min-w-0', block.checked && 'line-through opacity-60')}>
            <Spans spans={block.spans} />
          </span>
        </div>
      )
  }
}
