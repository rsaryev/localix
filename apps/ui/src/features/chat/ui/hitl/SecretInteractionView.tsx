import { useState } from 'react'
import { Lock } from 'lucide-react'
import { VAULT_ITEM_TYPE_DEFINITIONS } from '@localixai/api/client'
import { Button } from '@localixai/kit/button'
import { Input } from '@localixai/kit/input'
import { Kbd } from '@localixai/kit/kbd'
import type { PendingRequestSecretInteraction } from '../../model/agent-runtime'
import { HitlInteractionFrame } from './HitlInteractionFrame'
import type { HitlFrameChrome } from './HitlInteractionFrame'

interface SecretInteractionViewProps {
  interaction: PendingRequestSecretInteraction
  submitting: boolean
  keyboardActive?: boolean
  /** Rides the isolated submit-secret channel (backendClient.submitSecret), NOT onAnswer. */
  onSubmit: (requestId: string, value: string) => void
  onDismiss: (requestId: string) => void
  /** Which shell renders this view — the chat transcript, or the cross-session inbox dialog. */
  chrome?: HitlFrameChrome
}

/**
 * The masked prompt for the `request_secret` tool: shows WHICH key the agent wants
 * and WHY, collects the value in a single password input, and hands it to the
 * dedicated submit-secret channel. The value lives only in this component's local
 * state until submit, and is cleared the moment it is handed off — it never rides
 * the shared interact/respond path, and the agent only learns whether it was stored.
 */
export function SecretInteractionView({
  interaction,
  submitting,
  keyboardActive = true,
  onSubmit,
  onDismiss,
  chrome,
}: SecretInteractionViewProps) {
  const { id, title, payload } = interaction.request
  const [value, setValue] = useState('')
  const canSubmit = value.length > 0 && !submitting
  const type = VAULT_ITEM_TYPE_DEFINITIONS[payload.type]
  const rotating = payload.action === 'rotate'

  const submit = () => {
    if (!canSubmit) return
    onSubmit(id, value)
    // Drop the plaintext from local state immediately — the frame in flight is
    // the last place the UI holds it.
    setValue('')
  }

  return (
    <HitlInteractionFrame
      chrome={chrome}
      title={title ?? `${rotating ? 'Rotate' : 'Add'} ${payload.label ?? payload.key}`}
      detail="Never auto-filled — the agent is paused until you decide"
      expiresAt={interaction.request.expiresAt}
      onDismiss={() => onDismiss(id)}
      onSubmit={submitting ? undefined : submit}
      keyboardActive={keyboardActive}
      footer={
        <>
          <Button
            variant="ghost"
            size="lg"
            disabled={submitting}
            onClick={() => onDismiss(id)}
            className="text-text-soft hover:bg-surface-hover"
          >
            Deny
            <Kbd>esc</Kbd>
          </Button>
          <Button variant="mono" size="lg" disabled={!canSubmit} onClick={submit}>
            {submitting ? 'Storing…' : 'Approve'}
            <Kbd className="border-background/30 text-background/70">↵</Kbd>
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <div className="pb-0.5">
          <div className="mb-1 font-mono text-xs font-medium break-all text-text-strong">
            {payload.key}
          </div>
          <div className="mb-1 text-2xs font-medium uppercase tracking-wide text-text-faint">
            {type.label}
            {rotating && payload.expectedVersion ? ` · current v${payload.expectedVersion}` : ''}
          </div>
          <div className="text-xs leading-snug wrap-anywhere text-text-soft">{payload.reason}</div>
        </div>

        <Input
          size="xl"
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          disabled={submitting}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            // The frame's window listener defers to typing targets, so the input
            // handles its own Enter/Escape: submit, or route to the SAME dismiss
            // the X uses (the tool then returns "not provided").
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onDismiss(id)
            }
          }}
          placeholder={type.valuePlaceholder}
          aria-label={`${type.valueLabel} for ${payload.key}`}
        />

        <div className="flex min-w-0 items-start gap-1.5 text-2xs leading-snug text-text-faint">
          <Lock className="mt-px size-3 shrink-0" />
          <span className="min-w-0">
            {rotating ? 'Rotated' : 'Stored'} straight into the encrypted vault as{' '}
            <span className="font-mono break-all">secret:{payload.key}</span> — the agent is told
            only that it was stored, never the value.
          </span>
        </div>
      </div>
    </HitlInteractionFrame>
  )
}
