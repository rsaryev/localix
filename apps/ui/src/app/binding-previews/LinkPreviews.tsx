import type { MessageContextBindingDraft } from '@localixai/mini-app-sdk/ui'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { useChatStore } from '@/entities/chat/model/store'
import { WorkItemSessionProvider } from '@localixai/mini-app-sdk/ui/work-item-session'
import { ItemView } from '@/entities/chat/ui/tool-parts/ItemView'
import { ToolTimingProvider } from '@/entities/chat/ui/tool-parts/toolTimingContext'
import type { UiSession } from '@/shared/api/contracts'
import { formatRelativeTime } from '@/shared/ui/code-editor/inlineBlame'
import { useNow } from '@localixai/mini-app-sdk/ui/now'
import { MarkdownRenderer } from '@/shared/ui/MarkdownRenderer'
import {
  findToolCall,
  useLinkedSession,
  useListedSession,
  useSessionOfCall,
} from './useLinkedSession'

/**
 * What a link to the CONVERSATION looks like outside the chat: a session as its title, state and
 * last word; a message as the message; a tool call as the very card the transcript draws for it.
 *
 * These are the host's own renderers lent to a mini app through `ContextBindingPreview`, so a tool
 * call on a board is not a mini app's approximation of the chat's card that drifts from it — it IS
 * that card (`ItemView`), inside the same session context and timing the transcript gives it
 * (`MessageReplayTab` composes it the same way). A link whose target is gone says so in one line.
 */
const text = (binding: MessageContextBindingDraft, name: string) => {
  const value = binding.target.attributes?.[name]
  return typeof value === 'string' && value ? value : undefined
}
const ago = (ms: number, now: number) => formatRelativeTime(Math.floor(ms / 1000), now)

function Gone({ what, className }: { what: string; className?: string }) {
  return <p className={cn('px-3 py-2 text-2xs text-text-faint', className)}>{what}</p>
}

const STATUS: Record<UiSession['runtimeStatus'], { label: string; dot: string }> = {
  running: { label: 'Running', dot: 'bg-status-info animate-pulse' },
  idle: { label: 'Idle', dot: 'bg-text-faint' },
  completed: { label: 'Done', dot: 'bg-status-success' },
  failed: { label: 'Failed', dot: 'bg-status-error' },
  stopped: { label: 'Stopped', dot: 'bg-status-warning' },
}

/** The last thing said in a session, on one short paragraph. */
function lastWord(session: UiSession): string | undefined {
  const message = session.messages.findLast((row) => row.role !== 'system' && row.content?.trim())
  return message?.content?.trim()
}

export function SessionPreview({ binding, className }: PreviewProps) {
  const ref = text(binding, 'sessionId')
  const listed = useListedSession(ref)
  const linked = useLinkedSession(ref)
  const session = linked.state === 'ready' ? linked.session : listed
  const now = useNow(60_000)
  if (!session)
    return linked.state === 'loading' ? null : <Gone what="This session is not on this machine." />
  const status = STATUS[session.runtimeStatus] ?? STATUS.idle
  const said = linked.state === 'ready' ? lastWord(linked.session) : undefined
  return (
    <div className={cn('flex flex-col gap-1.5 px-3 py-2.5', className)}>
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden className={cn('size-2 shrink-0 rounded-full', status.dot)} />
        <span className="truncate text-xs font-semibold text-foreground">
          {session.title || 'Untitled session'}
        </span>
      </div>
      <div className="flex min-w-0 gap-1.5 text-3xs text-text-faint">
        <span className="font-mono">LOCALIX-{session.seq}</span>
        <span>·</span>
        <span>{status.label}</span>
        {session.agent && (
          <>
            <span>·</span>
            <span className="truncate">{session.agent.modelId}</span>
          </>
        )}
        <span>·</span>
        <span className="shrink-0">{ago(session.updatedAt, now)}</span>
      </div>
      {/* The last word as the chat renders it — clipped to three lines, never raw markdown. */}
      {said && (
        <div className="max-h-[4.2rem] overflow-hidden text-2xs leading-relaxed text-text-soft">
          <MarkdownRenderer>{said}</MarkdownRenderer>
        </div>
      )}
    </div>
  )
}

export function MessagePreview({ binding, className }: PreviewProps) {
  const linked = useLinkedSession(text(binding, 'sessionId'))
  if (linked.state === 'loading') return null
  const messageId = text(binding, 'messageId')
  const message =
    linked.state === 'ready' ? linked.session.messages.find((row) => row.id === messageId) : null
  if (!message || linked.state !== 'ready')
    return <Gone what="This message is not on this machine." />
  const author = message.role === 'user' ? 'You' : (linked.session.agent?.name ?? 'Assistant')
  return (
    <div className={cn('flex min-h-0 flex-col gap-1 px-3 py-2.5', className)}>
      <div className="flex gap-1.5 text-3xs text-text-faint">
        <span className="font-medium text-text-soft">{author}</span>
        <span>·</span>
        <span className="truncate">{linked.session.title}</span>
      </div>
      <div className="min-h-0 overflow-hidden text-xs">
        <MarkdownRenderer>{message.content ?? ''}</MarkdownRenderer>
      </div>
    </div>
  )
}

export function CallPreview({ binding, className }: PreviewProps) {
  const callId = text(binding, 'toolCallId')
  const found = useSessionOfCall(text(binding, 'sessionId') ? undefined : callId)
  const sessionRef = text(binding, 'sessionId') ?? found
  const linked = useLinkedSession(sessionRef)
  if (linked.state === 'loading') return null
  const call = linked.state === 'ready' && callId ? findToolCall(linked.session, callId) : null
  if (!call || linked.state !== 'ready')
    return <Gone what="This tool call is not in a conversation on this machine." />
  return (
    <WorkItemSessionProvider sessionId={linked.session.id}>
      <ToolTimingProvider tools={call.message.timing?.tools}>
        <div className={cn('min-w-0 px-2 py-1.5', className)}>
          <ItemView item={call.item} />
        </div>
      </ToolTimingProvider>
    </WorkItemSessionProvider>
  )
}

export function ProjectPreview({ binding, className }: PreviewProps) {
  const id = text(binding, 'projectId')
  const project = useChatStore((state) => state.projects.find((row) => row.id === id))
  const sessions = useChatStore(
    (state) => state.allSessions.filter((session) => session.projectId === id).length,
  )
  if (!project) return <Gone what="This project is not on this machine." />
  return (
    <div className={cn('flex flex-col gap-1 px-3 py-2.5', className)}>
      <span className="truncate text-xs font-semibold text-foreground">{project.name}</span>
      <span className="truncate font-mono text-3xs text-text-faint" title={project.workingDir}>
        {project.workingDir}
      </span>
      <span className="text-3xs text-text-faint">
        {sessions} session{sessions === 1 ? '' : 's'}
      </span>
    </div>
  )
}

export interface PreviewProps {
  binding: MessageContextBindingDraft
  className?: string
}

/** The conversation-side preview for a link, or null when its kind is not one of these. */
export function conversationPreview(kind: string) {
  return kind === 'session'
    ? SessionPreview
    : kind === 'message'
      ? MessagePreview
      : kind === 'call'
        ? CallPreview
        : kind === 'project'
          ? ProjectPreview
          : null
}
