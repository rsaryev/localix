import type { AgentItem, AgentSource } from '@localixai/agent/agents'

import { answerSourcesOfMessage } from '@/entities/chat/model/sessionSources'
import { inspector } from '@/shared/lib/inspectorBus'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { httpHref, sourceIcon } from './sources/SourceRow'

/**
 * The resources that actually entered model context for ONE answer.
 *
 * A thin filter over `collectSessionSources`, not a second collector: one gathering rule, two
 * scopes. The message id is synthetic because this caller has items rather than a message — the
 * function keys places by message and there is exactly one here.
 */
export function collectMessageSources(items: readonly AgentItem[] | undefined): AgentSource[] {
  return answerSourcesOfMessage({ id: 'message', items })
}

/**
 * The entry point to provenance in an assistant message's action row.
 *
 * It used to be a `<details>` that expanded the list in place. Two problems with that: the list
 * belongs to the SESSION, not to one answer — a file read three answers ago is just as much a
 * basis for this one — and expanding it shoved the conversation around to show a list nobody
 * asked for inline.
 *
 * The action opens the same Inspector work item as Tool activity, focused on its Sources section.
 * Chat stays visible; there is no modal, second navigation model, or transient overlay listener in
 * this common local click path.
 */
export function MessageSources({
  items,
  messageId,
  sessionId,
  sourceTargets,
}: {
  items: readonly AgentItem[] | undefined
  messageId: string
  sessionId?: string
  sourceTargets?: readonly { messageId: string; items: readonly AgentItem[] | undefined }[]
}) {
  const sources = collectMessageSources(items)
  if (sources.length === 0) return null

  const targets = sourceTargets
    ?.map((target, index) => ({
      ...target,
      index,
      count: collectMessageSources(target.items).length,
    }))
    .filter((target) => target.count > 0)
  const openSources = (id: string) => {
    if (sessionId) inspector.openMessageReplay(sessionId, id, 'sources')
  }

  const trigger = (
    <Button
      variant="ghost"
      size="default"
      data-sources-trigger
      data-source-count={sources.length}
      onClick={
        targets && targets.length > 1
          ? undefined
          : () => openSources(targets?.[0]?.messageId ?? messageId)
      }
      disabled={!sessionId}
      className="ml-0.5 gap-1.5 text-text-soft hover:bg-surface-hover hover:text-foreground"
      title={`Sources · ${sources.length}`}
      aria-label={`Open sources, ${sources.length}`}
    >
      <span className="isolate flex -space-x-1" aria-hidden="true">
        {sources.slice(0, 2).map((source) => {
          const SourceIcon = sourceIcon(source, httpHref(source.uri))
          return (
            <span
              key={`${source.kind}:${source.uri}`}
              className="flex size-4.5 items-center justify-center rounded-full border border-background bg-surface-hover text-text-faint"
            >
              <SourceIcon className="size-2.5" />
            </span>
          )
        })}
      </span>
      <span className="text-xs font-medium">Sources</span>
    </Button>
  )
  if (!targets || targets.length <= 1) return trigger
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        {targets.map((target) => (
          <DropdownMenuItem key={target.messageId} onSelect={() => openSources(target.messageId)}>
            Segment {target.index + 1} · {target.count} sources
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
