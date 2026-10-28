import { ArrowRight, Copy, MessageSquareText, X } from 'lucide-react'
import { useRef } from 'react'

import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import {
  Popover,
  PopoverAnchor,
  PopoverBody,
  PopoverContent,
  PopoverDescription,
  PopoverFooter,
  PopoverHeader,
  PopoverTitle,
} from '@localixai/kit/popover'

import type { ReaderNotePreview } from './model'

export interface ReaderNotePopoverValue {
  anchor: { x: number; y: number }
  chapter: number
  chapterTitle: string
  fragment: string
  origin: HTMLAnchorElement
  status: 'loading' | 'ready' | 'error'
  preview?: ReaderNotePreview
  error?: string
}

export function ReaderNotePopover({
  value,
  onClose,
  onNavigate,
  onAddContext,
  onCopy,
  onLink,
}: {
  value: ReaderNotePopoverValue
  onClose: () => void
  onNavigate: () => void
  onAddContext: () => void
  onCopy: () => void
  onLink: (anchor: HTMLAnchorElement) => void
}) {
  const returnFocusRef = useRef(true)
  const title = value.preview?.title ?? 'Opening note'
  return (
    <Popover open modal={false} onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed size-px"
          style={{ left: value.anchor.x, top: value.anchor.y }}
        />
      </PopoverAnchor>
      <PopoverContent
        layout="structured"
        role="dialog"
        aria-label={title}
        align="start"
        side="bottom"
        sideOffset={6}
        collisionPadding={8}
        className="w-[min(28rem,calc(100vw-1rem))]"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (returnFocusRef.current && value.origin.isConnected)
            value.origin.focus({ preventScroll: true })
        }}
      >
        <PopoverHeader
          actionsLabel="Note actions"
          actions={
            <IconButton size="sm" onClick={onClose} aria-label="Close note" tooltip="Close">
              <X />
            </IconButton>
          }
        >
          <PopoverTitle>{title}</PopoverTitle>
          <PopoverDescription>{value.chapterTitle}</PopoverDescription>
        </PopoverHeader>
        <PopoverBody className="min-h-20 max-h-[min(24rem,55vh)]">
          {value.status === 'loading' ? (
            <LoadingHint className="min-h-20">Opening note…</LoadingHint>
          ) : value.status === 'error' ? (
            <div className="flex min-h-20 items-center text-xs/5 text-text-soft">
              {value.error ?? 'This note could not be opened.'}
            </div>
          ) : (
            // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- delegated link clicks: the links inside the note are native anchors, so Enter reaches this handler as a click
            <div
              className="reader-note-popover-content select-text text-sm/6 text-foreground"
              onClick={(event) => {
                const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>(
                  'a[href]',
                )
                if (!anchor || !event.currentTarget.contains(anchor)) return
                event.preventDefault()
                returnFocusRef.current = false
                onLink(anchor)
              }}
              dangerouslySetInnerHTML={{ __html: value.preview?.html ?? '' }}
            />
          )}
        </PopoverBody>
        <PopoverFooter className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onCopy} disabled={value.status !== 'ready'}>
            <Copy data-icon="inline-start" /> Copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onAddContext}
            disabled={value.status !== 'ready'}
          >
            <MessageSquareText data-icon="inline-start" /> Add context
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              returnFocusRef.current = false
              onNavigate()
            }}
          >
            Go to note <ArrowRight data-icon="inline-end" />
          </Button>
        </PopoverFooter>
      </PopoverContent>
    </Popover>
  )
}
