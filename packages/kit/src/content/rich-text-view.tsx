import type { ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import {
  isRichTextHref,
  type RichBlock,
  type RichInline,
  type RichTextValue,
} from '@localixai/mini-app-sdk/rich-text'

function inline(part: RichInline, index: number): ReactNode {
  if (part.type === 'hardBreak') return <br key={index} />
  let node: ReactNode = part.text
  if (part.marks?.some((mark) => mark.type === 'bold')) node = <strong>{node}</strong>
  if (part.marks?.some((mark) => mark.type === 'italic')) node = <em>{node}</em>
  const link = part.marks?.find((mark) => mark.type === 'link')
  if (link?.type === 'link' && isRichTextHref(link.attrs.href))
    node = (
      <a href={link.attrs.href} target="_blank" rel="noopener noreferrer" className="underline">
        {node}
      </a>
    )
  return <span key={index}>{node}</span>
}
function block(node: RichBlock, index: number): ReactNode {
  if (node.type === 'paragraph')
    return (
      <p key={index} className="whitespace-pre-wrap">
        {node.content?.map(inline)}
      </p>
    )
  const children = node.content.map((item, i) => <li key={i}>{item.content.map(block)}</li>)
  return node.type === 'orderedList' ? (
    <ol
      key={index}
      start={node.attrs?.start}
      type={node.attrs?.type ?? undefined}
      className="list-decimal space-y-1 pl-5"
    >
      {children}
    </ol>
  ) : (
    <ul key={index} className="list-disc space-y-1 pl-5">
      {children}
    </ul>
  )
}

/** Restricted structured prose. Text and attributes are never interpreted as HTML. */
export function RichTextView({ value, className }: { value: RichTextValue; className?: string }) {
  return (
    <div className={cn('space-y-2 leading-relaxed', className)}>
      {typeof value === 'string' ? (
        <p className="whitespace-pre-wrap">{value}</p>
      ) : (
        value.content.map(block)
      )}
    </div>
  )
}
