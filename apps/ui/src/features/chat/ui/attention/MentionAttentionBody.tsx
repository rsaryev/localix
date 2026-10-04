/**
 * "@lead is asking you" — a participant addressed the person by name in a chat they are not in.
 *
 * Only a way in, never a reply box: a mention is answered by an ordinary message, and a composer
 * here would have no attachments, no bindings and no transcript above it — the very context the
 * question needs. Nothing is blocked while it is open (the room went quiet on its own), so the
 * dialog's Escape snoozes it and the question stays in the transcript and the Event Center.
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
      {/* Named by WHO is asking, because in a room that is the first thing worth knowing. */}
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
            {from ? `@${from} is asking you` : 'A participant is asking you'}
          </span>
        </DialogTitle>
      </DialogHeader>
      {/* The one scroll-owning region, so a long question scrolls under a pinned header. */}
      <DialogBody className="space-y-3">
        {/* The question itself, quoted: "you were mentioned" alone makes the person open the chat
            to find out whether it even mattered. */}
        {item.summary ? (
          <blockquote className="border-l-2 border-border pl-3 text-xs leading-relaxed whitespace-pre-wrap text-text-soft">
            {item.summary}
          </blockquote>
        ) : null}
        <p className="text-2xs text-text-faint">
          <span className="truncate">{sessionTitle}</span>
          {Number.isFinite(at) ? ` · ${formatRelativeTime(at)}` : ''}
          {' · the conversation is waiting for your answer'}
        </p>
      </DialogBody>
    </DialogContent>
  )
}
