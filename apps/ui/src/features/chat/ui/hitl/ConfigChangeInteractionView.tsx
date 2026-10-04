import { Button } from '@localixai/kit/button'
import { Kbd } from '@localixai/kit/kbd'
import type { PendingConfigChangeInteraction } from '@/shared/api/contracts'
import { HitlInteractionFrame } from './HitlInteractionFrame'
import type { HitlFrameChrome } from './HitlInteractionFrame'

interface ConfigChangeInteractionViewProps {
  interaction: PendingConfigChangeInteraction
  submitting: boolean
  keyboardActive?: boolean
  onSubmit: (requestId: string, answers: { approved: boolean }) => void
  onDismiss: (requestId: string) => void
  chrome?: HitlFrameChrome
}

const RELOAD_HINT: Record<string, string> = {
  immediate: 'Takes effect immediately',
  'next-run': 'Takes effect on the next turn',
  'new-session': 'Takes effect in new sessions',
  restart: 'Takes effect after a restart',
}

/**
 * The card for an agent-PROPOSED configuration change: what changes, why the agent asked,
 * whose rules it lands in, and one click to approve.
 *
 * Deliberately no "this session" option — configuration is persistent by nature. There is no
 * WHERE option either: rules belong to an agent, so a proposal lands on the agent that made
 * it and the card states that rather than asking. The remedy id is not shown: it is an
 * internal identifier, and a proposal to DISABLE something arriving under the id
 * `tool.enable` reads as a contradiction to the one person who has to decide.
 */
export function ConfigChangeInteractionView({
  interaction,
  submitting,
  keyboardActive = true,
  onSubmit,
  onDismiss,
  chrome,
}: ConfigChangeInteractionViewProps) {
  const { id, title, payload } = interaction.request
  const answer = (approved: boolean) => onSubmit(id, { approved })

  return (
    <HitlInteractionFrame
      chrome={chrome}
      title={title ?? payload.title}
      detail={payload.detail}
      expiresAt={interaction.request.expiresAt}
      onDismiss={() => onDismiss(id)}
      onSubmit={submitting ? undefined : () => answer(true)}
      keyboardActive={keyboardActive}
      footer={
        <>
          <Button
            variant="ghost"
            size="lg"
            disabled={submitting}
            onClick={() => answer(false)}
            className="text-text-soft hover:bg-surface-hover"
          >
            Deny
            <Kbd>esc</Kbd>
          </Button>
          <Button variant="mono" size="lg" disabled={submitting} onClick={() => answer(true)}>
            {submitting ? 'Applying…' : 'Approve'}
            <Kbd className="border-background/30 text-background/70">↵</Kbd>
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5 pb-0.5">
        {payload.diff.length > 0 && (
          <div className="rounded-lg border border-border bg-surface-sunken/60 px-2.5 py-2">
            <div className="flex flex-col gap-0.5 font-mono text-2xs leading-relaxed text-text-strong">
              {payload.diff.map((line, index) => (
                <div key={index} className="break-all">
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}

        {payload.reason && (
          // The agent's own sentence, attributed. Never merged into the header's detail line,
          // which is clamped to one line and would elide exactly the part worth reading.
          <div className="flex min-w-0 gap-1.5 text-2xs leading-relaxed text-text-soft">
            <span className="shrink-0 text-text-faint">Agent:</span>
            <span className="min-w-0">{payload.reason}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 text-2xs text-text-faint">
          <span>Applies to</span>
          <span className="font-mono text-text-soft">{payload.agentId}</span>
        </div>

        <div className="text-2xs text-text-faint">
          {RELOAD_HINT[payload.reload] ?? payload.reload}. Recorded as proposed by the agent and
          reversible in Settings → Capabilities.
        </div>
      </div>
    </HitlInteractionFrame>
  )
}
