/**
 * "@lead assigned you a card" — a board card in a chat the person is not in now waits on them.
 *
 * Only a way in, never a reply box: the card is handled on the board or by an ordinary message,
 * and a composer here would have no attachments, no bindings and no transcript above it. Nothing is
 * blocked while it is open, so the dialog's Escape snoozes it and the card stays on the board and
 * in the Event Center. Questions never arrive here: agents ask through `ask` (an HITL card).
 */
import { ArrowUpRight, AtSign } from 'lucide-react'
import { MonogramAvatar } from '@localixai/kit/avatar'
import { Button } from '@localixai/kit/button'
import { DialogBody, DialogContent, DialogHeader, DialogTitle } from '@localixai/kit/dialog'
import { formatRelativeTime } from '@localixai/plugin-sdk/ui/utilities'

import type { AttentionBodyProps } from './types'

export function MentionAttentionBody({ item, sessionTitle, openChat }: AttentionBodyProps) {
  const from = item.subject.agentHandle ?? ''
  const at = Date.parse(item.at)
  return (
    <DialogContent size="md" aria-describedby={undefined}>
      {/* Named by WHO assigned it, because in a room that is the first thing worth knowing. */}
      <DialogHeader
        actionsLabel="Mention actions"
        actions={
          <Button variant="ghost" size="xs" onClick={openChat} className="text-text-faint">
            Open chat
            <ArrowUpRight className="size-3" />
          </Button>
        }
      >
        <DialogTitle className="flex min-w-0 items-center gap-2 text-sm font-medium">
          {from ? (
            <MonogramAvatar identity={from} label={from} size={18} />
          ) : (
            <AtSign className="size-4 shrink-0 text-text-faint" />
          )}
          <span className="truncate">
            {from ? `@${from} assigned you a card` : 'A card is assigned to you'}
          </span>
        </DialogTitle>
      </DialogHeader>
      {/* The one scroll-owning region, so a long question scrolls under a pinned header. */}
      <DialogBody className="space-y-3">
        {/* The card itself, quoted: a bare "you have a card" makes the person open the chat to
            find out whether it even mattered. */}
        {item.summary ? (
          <blockquote className="border-l-2 border-border pl-3 text-xs leading-relaxed whitespace-pre-wrap text-text-soft">
            {item.summary}
          </blockquote>
        ) : null}
        <p className="text-2xs text-text-faint">
          <span className="truncate">{sessionTitle}</span>
          {Number.isFinite(at) ? ` · ${formatRelativeTime(at)}` : ''}
          {' · the card is waiting for you'}
        </p>
      </DialogBody>
    </DialogContent>
  )
}
