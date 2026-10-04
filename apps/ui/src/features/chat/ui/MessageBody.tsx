import type { ReactElement, ReactNode } from 'react'
import { Fragment } from 'react'
import { TaskScope } from '@/shared/ui/MarkdownTaskList'
import type { AgentItem } from '@localixai/agent/agents'
import { isTextItem } from '@localixai/agent/agents/items'
import { isToolBacked, isStandaloneItem } from './tool-parts/itemHelpers'
import type { Message } from '../model/types'
import { MessageReasoning } from './MessageReasoning'
import { TextBubble } from './MessageBubbles'
import { ToolChain } from './tool-parts/ToolChain'
import { projectMessageItems } from './messageItemProjection'
import { inlineNoticeSegments } from './inlineNoticeSegments'
import { SystemNoticeLine } from './SystemNoticeLine'
import { messageDisplayText } from '../model/messageDisplayText'

/**
 * A message's ordered items as rendered nodes — the one place that knows how a run of items
 * becomes chains, disclosures and bubbles.
 *
 * Its own module because it answers a different question from the card around it: the card
 * decides what a message IS (who said it, where it sits in a run, what its footer offers),
 * this decides how its contents are laid out. They were one function only because they grew
 * together.
 */
export function MessageBody({
  message,
  isUser,
  isStreaming,
  isLast,
  mentionHandles,
}: {
  message: Message
  isUser: boolean
  isStreaming?: boolean
  isLast?: boolean
  /** The conversation's members, for clickable `@handle` mentions. Absent in a one-to-one. */
  mentionHandles?: readonly string[]
}): ReactNode {
  const messageId = message.id
  // An agent's checklist is tickable (`MarkdownTaskList.tsx`); a person's own message is not,
  // and neither is a reply still streaming — its boxes may yet move.
  const withTasks = (scope: string, bubble: ReactElement) =>
    isUser || isStreaming ? (
      bubble
    ) : (
      <TaskScope
        key={bubble.key ?? scope}
        messageId={messageId}
        scope={scope}
        states={message.taskStates}
      >
        {bubble}
      </TaskScope>
    )
  if (message.inlineNotices?.length) {
    const segments = inlineNoticeSegments(message)
    const lastBodyIndex = segments.findLastIndex((segment) => segment.kind === 'body')
    return segments.map((segment, index) =>
      segment.kind === 'notice' ? (
        <SystemNoticeLine key={segment.message.id} notice={segment.message.systemNotice!} />
      ) : (
        <Fragment key={`body-${index}`}>
          {MessageBody({
            message: {
              ...message,
              inlineNotices: undefined,
              items: segment.items,
              content: segment.content,
            },
            isUser,
            isStreaming: isStreaming && index === lastBodyIndex,
            isLast: isLast && index === lastBodyIndex,
            mentionHandles,
          })}
        </Fragment>
      ),
    )
  }
  // Render items in order: consecutive tool-backed items batch into ONE
  // ToolChain; consecutive reasoning parts batch into ONE disclosure. Text and
  // tools remain hard boundaries, yielding chain → reasoning → text → new chain.
  if (message.items?.length) {
    const lastIndex = message.items.length - 1
    const displayItems = projectMessageItems(message.items)
    const nodes: ReactNode[] = []
    let run: AgentItem[] = []
    let lastChainIndex = -1
    let lastChainItems: AgentItem[] = []

    const flushRun = () => {
      if (!run.length) return
      lastChainIndex = nodes.length
      lastChainItems = run
      // Key on the chain's FIRST item id (stable) — NOT the node index. With a
      // positional key, streaming items that shift node positions remounted the
      // chain every delta, resetting its open/closed state and replaying the
      // collapse animation (the "jumping"). A stable identity keeps it mounted.
      nodes.push(
        <ToolChain
          key={`chain-${run[0]!.id}`}
          items={run}
          messageId={messageId}
          deferredToolItemIds={message.deferredToolItemIds}
        />,
      )
      run = []
    }

    displayItems.forEach((displayItem) => {
      if (displayItem.kind === 'reasoning') {
        flushRun()
        nodes.push(
          <MessageReasoning
            key={`reasoning-${displayItem.key}`}
            text={displayItem.text}
            isStreaming={isStreaming && displayItem.lastIndex === lastIndex}
          />,
        )
        return
      }

      const { item, index } = displayItem
      if (isToolBacked(item)) {
        // Interactive/live tools (stream, ask, quiz) break the run:
        // they render as a standalone single-item chain so a collapsing
        // cluster can never fold or unmount them.
        if (isStandaloneItem(item)) {
          flushRun()
          nodes.push(
            <ToolChain
              key={item.id}
              items={[item]}
              messageId={messageId}
              deferredToolItemIds={message.deferredToolItemIds}
            />,
          )
          return
        }
        run.push(item)
        return
      }
      // Narrative item: flush the current chain, then emit its text. Only a VISIBLE one ends
      // the chain: the runtime opens every text block with an empty delta, and that empty item
      // used to split a run of tool calls invisibly — the chain above it lost `isLatest` and
      // folded, and the next call started a fresh chain below it.
      const text = isTextItem(item)
        ? isUser
          ? messageDisplayText(item.text, message.bindings)
          : item.text
        : ''
      if (isTextItem(item) && !text.trim()) return
      flushRun()
      if (isTextItem(item)) {
        nodes.push(
          withTasks(
            item.id,
            <TextBubble
              key={item.id}
              content={text}
              isUser={isUser}
              isStreaming={isStreaming && index === lastIndex}
              mentionHandles={mentionHandles}
            />,
          ),
        )
      }
    })
    flushRun()

    if (isLast && lastChainIndex >= 0) {
      // Reuse the SAME stable key as the initial push so flipping `isLatest`
      // updates props in place instead of remounting (which would re-collapse).
      nodes[lastChainIndex] = (
        <ToolChain
          key={`chain-${lastChainItems[0]!.id}`}
          items={lastChainItems}
          messageId={messageId}
          deferredToolItemIds={message.deferredToolItemIds}
          isLatest
        />
      )
    }
    return nodes
  }

  // Flat history and optimistic sends use the same display-only projection as text items.
  const content = isUser
    ? messageDisplayText(message.content ?? '', message.bindings)
    : message.content
  return content
    ? withTasks(
        'content',
        <TextBubble
          content={content}
          isUser={isUser}
          isStreaming={isStreaming}
          mentionHandles={mentionHandles}
        />,
      )
    : null
}
