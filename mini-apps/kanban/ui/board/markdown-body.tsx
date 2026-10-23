import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { MarkdownRenderer } from '@localixai/kit/markdown'

/** Compact task text rendered as Markdown. */
export function MdBody({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={cn(
        'text-sm leading-6 text-foreground [&_p]:my-1 [&_pre]:my-1.5 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm',
        className,
      )}
    >
      <MarkdownRenderer>{text}</MarkdownRenderer>
    </div>
  )
}
