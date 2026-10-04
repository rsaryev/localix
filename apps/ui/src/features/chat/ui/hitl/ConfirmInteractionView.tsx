import { useState } from 'react'
import { Bot, Terminal } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { Kbd } from '@localixai/kit/kbd'
import { HitlInteractionFrame } from './HitlInteractionFrame'
import type { HitlFrameChrome } from './HitlInteractionFrame'
import {
  ConfirmGrantControls,
  ScopeTrail,
  deepestTarget,
  effectiveDuration,
  initialGrantChoice,
  type GrantChoice,
} from './ConfirmGrantControls'
import { ConfirmReply, ConfirmReplyButton } from './ConfirmReply'

/**
 * The shared shape, not a local restatement of it.
 *
 * This file used to declare its own `PendingConfirmInteraction` alongside the one in
 * `shared/api/contracts.ts` that the host actually sends — so the payload existed twice, and
 * a field added to the wire had to be remembered here or the card silently could not see it.
 * `expiresAt` was the second field in a row to be missed that way.
 */
import type { PendingConfirmInteraction } from '@/shared/api/contracts'
export type { PendingConfirmInteraction }

export interface ConfirmAnswers {
  confirmed: boolean
  scope?: 'once' | 'session' | 'always'
  /** The offered breadth (`ConfirmGrantOption.id`) a widening answer means. */
  grant?: string
  /** Words for the agent, sent with the verdict. */
  message?: string
}

interface ConfirmInteractionViewProps {
  interaction: PendingConfirmInteraction
  submitting: boolean
  keyboardActive?: boolean
  onSubmit: (requestId: string, answers: ConfirmAnswers) => void
  onDismiss: (requestId: string) => void
  /** Which shell renders this view — the chat transcript, or the cross-session inbox dialog. */
  chrome?: HitlFrameChrome
}

/**
 * Keyed by request: the overlay renders this view for request after request, and a level
 * picked or a reply typed for one card must not survive onto the next.
 */
export function ConfirmInteractionView(props: ConfirmInteractionViewProps) {
  return <ConfirmCard key={props.interaction.request.id} {...props} />
}

/**
 * A path split so the NAME carries the weight and the folders read as its address.
 *
 * It wraps AT the separators: `break-all` broke wherever the line ran out, which split the one
 * word a person reads first (`useThe` / `me.ts`). A break opportunity after every separator,
 * with `wrap-anywhere` as the fallback, keeps a name whole unless it cannot fit on a line.
 */
function PathLine({ path }: { path: string }) {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1
  const folders = path.slice(0, cut).split(/(?<=[/\\])/u)
  return (
    <div className="font-mono text-xs leading-relaxed wrap-anywhere">
      <span className="text-text-faint">
        {folders.map((segment, index) => (
          <span key={index}>
            {segment}
            <wbr />
          </span>
        ))}
      </span>
      <span className="font-medium text-text-strong">{path.slice(cut)}</span>
    </div>
  )
}

function ConfirmCard({
  interaction,
  submitting,
  keyboardActive = true,
  onSubmit,
  onDismiss,
  chrome,
}: ConfirmInteractionViewProps) {
  const { id, title, payload } = interaction.request
  // Every producer before `subject` existed sent a shell command, so its absence means one.
  const subject = payload.subject ?? 'command'
  const grants = payload.grants ?? []
  const isSubagent = payload.sourceKind === 'subagent' && Boolean(payload.sourceTitle)
  const addressee = isSubagent ? 'sub-agent' : 'agent'

  const [choice, setChoice] = useState<GrantChoice>(() => initialGrantChoice(grants))
  const [replyOpen, setReplyOpen] = useState(false)
  const [reply, setReply] = useState('')
  const message = reply.trim() ? { message: reply.trim() } : {}

  const grant = grants.find((option) => option.id === choice.grantId) ?? grants[0]
  const duration = effectiveDuration(choice, grant)
  // The folder levels are drawn ON a path. One file: its own path is the trail, so the subject
  // and the picker are the same line. Several: their common folder, under the list of them.
  const trail = subject === 'path' ? deepestTarget(grants) : undefined
  const trailIsSubject = trail !== undefined && trail === payload.command
  const approve = () =>
    onSubmit(id, {
      confirmed: true,
      ...(grant && duration !== 'once' ? { scope: duration, grant: grant.id } : {}),
      ...message,
    })
  const deny = () => onSubmit(id, { confirmed: false, ...message })
  // Closing the card refuses it either way; with a reply written, closing must not also
  // throw the reply away, so it becomes the Deny it already means.
  const dismiss = () => (reply.trim() ? deny() : onDismiss(id))

  return (
    <HitlInteractionFrame
      chrome={chrome}
      title={title ?? 'Confirm command execution'}
      // The matched rule's own words. A sub-agent's card used to overwrite them with a fixed
      // "Run this sub-agent", so the one line saying WHY it asked was gone.
      detail={payload.description}
      expiresAt={interaction.request.expiresAt}
      onDismiss={dismiss}
      onSubmit={submitting ? undefined : approve}
      keyboardActive={keyboardActive}
      footer={
        <>
          {!replyOpen && (
            <ConfirmReplyButton
              onOpen={() => setReplyOpen(true)}
              addressee={addressee}
              disabled={submitting}
            />
          )}
          <Button
            variant="ghost"
            size="lg"
            disabled={submitting}
            onClick={deny}
            className="text-text-soft hover:bg-surface-hover"
          >
            Deny
            <Kbd>esc</Kbd>
          </Button>
          <Button variant="mono" size="lg" disabled={submitting} onClick={approve}>
            {submitting ? 'Running…' : 'Approve'}
            <Kbd className="border-background/30 text-background/70">↵</Kbd>
          </Button>
        </>
      }
    >
      <div className="space-y-2.5">
        <div className="space-y-1">
          {/* WHO asked, above WHAT. A sub-agent's card used to show its task title INSTEAD of
              the subject, so a person was asked to approve a read without seeing the file. */}
          {isSubagent && (
            <div className="flex min-w-0 items-center gap-1.5 text-2xs text-text-faint">
              <Bot className="size-3 shrink-0" />
              <span className="shrink-0">Sub-agent</span>
              <span className="min-w-0 truncate text-text-soft" title={payload.sourceTitle}>
                {payload.sourceTitle}
              </span>
            </div>
          )}
          {/* A shell call runs in a directory and the prompt glyph says so; a file call names
              its own path, and drawing a terminal over it described the wrong thing. */}
          {subject === 'command' && (
            <div className="flex min-w-0 items-center gap-1.5 text-2xs text-text-faint">
              <Terminal className="size-3 shrink-0" />
              <span className="min-w-0 truncate font-mono">{payload.cwd ?? '~'}</span>
            </div>
          )}
          {subject === 'path' && !trailIsSubject && (
            <div className="space-y-0.5">
              {payload.command.split('\n').map((path) => (
                <PathLine key={path} path={path} />
              ))}
            </div>
          )}
          {trail !== undefined && (
            <ScopeTrail
              trail={trail}
              grants={grants}
              choice={choice}
              onChange={setChoice}
              disabled={submitting}
            />
          )}
          {subject !== 'path' && (
            <pre className="font-mono text-xs leading-relaxed text-text-strong whitespace-pre-wrap break-all">
              {payload.command}
            </pre>
          )}
        </div>

        {/* Only the breadths the host will honour; none means this approval covers one call. */}
        {grant && (
          <ConfirmGrantControls
            grant={grant}
            choice={choice}
            onChange={setChoice}
            disabled={submitting}
          />
        )}

        {replyOpen && (
          <ConfirmReply
            value={reply}
            onChange={setReply}
            addressee={addressee}
            disabled={submitting}
          />
        )}
      </div>
    </HitlInteractionFrame>
  )
}
