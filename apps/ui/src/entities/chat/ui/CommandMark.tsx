import { SquareTerminal } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/**
 * Quiet provenance mark for slash commands. The terminal glyph distinguishes
 * command execution from search without adding another pill inside a message.
 */
export function CommandMark({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 font-medium', className)}>
      <SquareTerminal className="size-[1em] shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}
