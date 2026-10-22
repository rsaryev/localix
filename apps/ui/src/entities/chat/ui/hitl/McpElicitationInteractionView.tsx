import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { McpElicitationAnswer } from '@localixai/api/client'
import { Button } from '@localixai/kit/button'
import { Kbd } from '@localixai/kit/kbd'
import type { PendingMcpElicitationInteraction } from '@/shared/api/contracts'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { HitlInteractionFrame } from './HitlInteractionFrame'
import type { HitlFrameChrome } from './HitlInteractionFrame'
import { ElicitationFields, useElicitationForm } from './McpElicitationForm'

interface McpElicitationInteractionViewProps {
  interaction: PendingMcpElicitationInteraction
  submitting: boolean
  keyboardActive?: boolean
  onSubmit: (requestId: string, answers: McpElicitationAnswer) => void
  /** Esc and the close button: the server is told the person cancelled. */
  onDismiss: (requestId: string) => void
  chrome?: HitlFrameChrome
}

/**
 * The card for an MCP server asking, mid tool call, for input. Three answers, as in Claude Code:
 * Submit (or Open, for a URL request) accepts, Decline declines, Esc cancels. The server sees
 * only the fields its form names, checked against that form before Submit sends them.
 */
export function McpElicitationInteractionView({
  interaction,
  submitting,
  keyboardActive = true,
  onSubmit,
  onDismiss,
  chrome,
}: McpElicitationInteractionViewProps) {
  const { id, title, payload } = interaction.request
  const isUrl = payload.mode === 'url'
  const form = useElicitationForm(payload.requestedSchema)
  const [attempted, setAttempted] = useState(false)

  const accept = () => {
    if (submitting) return
    if (isUrl) {
      // The system browser, as for a provider sign-in: URL mode is how servers ask for one.
      if (payload.url) platformCapabilities().external.open(payload.url, true)
      onSubmit(id, { action: 'accept' })
      return
    }
    setAttempted(true)
    if (form.check.ok) onSubmit(id, { action: 'accept', content: form.check.content })
  }

  return (
    <HitlInteractionFrame
      chrome={chrome}
      title={title ?? `${payload.server} asks for input`}
      detail={`MCP server ${payload.server}`}
      expiresAt={interaction.request.expiresAt}
      expiryOutcome="continue"
      dismissLabel="Cancel"
      onDismiss={() => onDismiss(id)}
      onSubmit={submitting ? undefined : accept}
      keyboardActive={keyboardActive}
      footer={
        <>
          <Button
            variant="ghost"
            size="lg"
            disabled={submitting}
            onClick={() => onSubmit(id, { action: 'decline' })}
            className="text-text-soft hover:bg-surface-hover"
          >
            Decline
          </Button>
          <Button variant="mono" size="lg" disabled={submitting} onClick={accept}>
            {submitting ? 'Sending…' : isUrl ? 'Open' : 'Submit'}
            <Kbd className="border-background/30 text-background/70">↵</Kbd>
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5 pb-0.5">
        <div className="text-xs leading-snug whitespace-pre-wrap wrap-anywhere text-text-strong">
          {payload.message}
        </div>
        {isUrl ? (
          <div className="flex min-w-0 items-start gap-1.5 text-2xs leading-snug text-text-faint">
            <ExternalLink className="mt-px size-3 shrink-0" />
            <span className="min-w-0">
              Opens <span className="font-mono break-all text-text-soft">{payload.url}</span> in
              your browser. The server continues once you finish there.
            </span>
          </div>
        ) : (
          <ElicitationFields
            form={form}
            required={payload.requestedSchema?.required ?? []}
            showErrors={attempted}
            disabled={submitting}
            onEnter={accept}
          />
        )}
      </div>
    </HitlInteractionFrame>
  )
}
