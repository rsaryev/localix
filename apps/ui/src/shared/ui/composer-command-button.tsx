import type { ComponentProps } from 'react'
import { SquareTerminal } from 'lucide-react'

import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { composerBus } from '@/shared/lib/composerBus'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from '@localixai/kit/button'

export type ComposerCommandButtonProps = Omit<
  ComponentProps<typeof Button>,
  'children' | 'onClick'
> & {
  /** Command shown to the user. */
  command: string
  /** Text staged in the composer; defaults to the visible command. */
  insertText?: string
  /**
   * The chat whose composer receives the command. Omitted, it is the chat the surrounding
   * transcript or tab belongs to (`useWorkItemSessionId`) — never the focused composer, which put
   * a command shown in one chat into another's draft. With neither, the button is disabled.
   */
  sessionId?: string | null
  /** Replace the current draft instead of appending to it. */
  replace?: boolean
}

/**
 * Shared clickable command token. It stages an editable command through the
 * canonical composer bus, so empty states, tips, and mini app surfaces never
 * grow their own prompt-prefill path.
 */
export function ComposerCommandButton({
  command,
  insertText = command,
  sessionId,
  replace,
  className,
  title = 'Insert into composer',
  disabled,
  ...props
}: ComposerCommandButtonProps) {
  const ownerSessionId = useWorkItemSessionId()
  const target = sessionId === undefined ? ownerSessionId : sessionId
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      data-slot="composer-command-button"
      className={cn(
        'h-auto min-h-5 shrink-0 gap-1 rounded-md bg-transparent px-1.5 py-0.5 font-mono text-2xs text-text-soft hover:text-text-strong',
        className,
      )}
      title={title}
      disabled={disabled || !target}
      onClick={() => {
        if (!target) return
        composerBus.insert({
          text: insertText,
          sessionId: target,
          replace,
          buffer: true,
        })
      }}
      {...props}
    >
      <SquareTerminal className="size-3.5" aria-hidden="true" />
      {command}
    </Button>
  )
}
