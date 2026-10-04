/**
 * THE ONE CROSS-SESSION PROMPT: something in a chat the person is not looking at is waiting on
 * them — a blocked request, a plan to decide on, a mention by name.
 *
 * There used to be one dialog per kind, each with its own inbox, and they had to know about each
 * other: the mention dialog read the HITL inbox to stay out of the way, and a presented plan had
 * no dialog at all. Two modals is a stack the person digs out of in an order nobody chose. So one
 * shell, mounted once at page level (it surfaces over the chat, settings or stats alike), raises
 * the single item `dialogAttentionItem` picks from the shared roster, and renders that kind's body
 * from `presentation.tsx`.
 *
 * Escape / the overlay only SNOOZE, in this window, by item key: the run keeps waiting, the row
 * keeps its badge, the dock keeps its count, and a new item in the same chat still prompts.
 * Opening a chat settles its items the same way — the chat shows them in place from then on.
 */
import { useEffect } from 'react'

import { dialogAttentionItem } from '@/features/chat/model/attention/select'
import { snoozeAttention, useAttentionStore } from '@/features/chat/model/attention/store'
import { useChatStore } from '@/features/chat/model/store'
import { useRoutedNavigation } from '@/shared/hooks/useRoutedNavigation'
import { Dialog } from '@localixai/kit/dialog'
import { ATTENTION_PRESENTATION } from './presentation'

export function AttentionDialog() {
  const nav = useRoutedNavigation()
  const items = useAttentionStore((state) => state.items)
  const snoozed = useAttentionStore((state) => state.snoozed)
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  // The waiting chat may be in another project, so its row comes from the full set.
  const allSessions = useChatStore((state) => state.allSessions)

  useEffect(() => {
    if (!activeSessionId) return
    for (const item of items) if (item.sessionId === activeSessionId) snoozeAttention(item.key)
  }, [activeSessionId, items])

  const item = dialogAttentionItem(items, activeSessionId, snoozed)
  const Body = item ? ATTENTION_PRESENTATION[item.kind].Body : undefined
  if (!item || !Body) return null

  const session = allSessions.find((candidate) => candidate.id === item.sessionId)
  const settle = () => snoozeAttention(item.key)
  const openChat = () => {
    // Settled first so the dialog goes at once instead of lingering a frame over the chat it opened.
    settle()
    nav.goToSession(item.sessionId, session ? { project: session.projectId } : undefined)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && settle()}>
      <Body
        key={item.key}
        item={item}
        session={session}
        sessionTitle={session?.title?.trim() || 'A background chat'}
        openChat={openChat}
        settle={settle}
      />
    </Dialog>
  )
}
