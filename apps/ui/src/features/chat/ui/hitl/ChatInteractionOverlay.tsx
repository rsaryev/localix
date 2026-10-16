import type { ReactNode } from 'react'
import type { PendingHitlInteraction } from '../../model/agent-runtime'
import { AskInteractionView } from './AskInteractionView'
import type { HitlFrameChrome } from './HitlInteractionFrame'
import { ConfirmInteractionView } from './ConfirmInteractionView'
import { ConfigChangeInteractionView } from './ConfigChangeInteractionView'
import { SecretInteractionView } from './SecretInteractionView'

interface HitlRendererProps<TInteraction extends PendingHitlInteraction = PendingHitlInteraction> {
  interaction: TInteraction
  submitting: boolean
  keyboardActive: boolean
  /** Passed straight through to the frame: chat transcript vs. cross-session inbox dialog. */
  chrome: HitlFrameChrome | undefined
  onAnswer: (requestId: string, answers: unknown) => void
  /** request_secret only: the value's isolated side-channel, never the interact path. */
  onSubmitSecret: (requestId: string, value: string) => void
  onDismiss: (requestId: string) => void
}

interface HitlRenderer<TInteraction extends PendingHitlInteraction = PendingHitlInteraction> {
  kind: TInteraction['kind']
  render: (props: HitlRendererProps<TInteraction>) => ReactNode
}

interface ChatInteractionOverlayProps {
  interaction: PendingHitlInteraction | null
  submittingRequestId: string | null
  /** Global HITL shortcuts belong only to the focused warm chat surface. */
  keyboardActive: boolean
  /** Which shell owns this interaction. Defaults to the in-transcript card. */
  chrome?: HitlFrameChrome
  onAnswer: (requestId: string, answers: unknown) => void
  /** request_secret only: the value's isolated side-channel, never the interact path. */
  onSubmitSecret: (requestId: string, value: string) => void
  onDismiss: (requestId: string) => void
}

const renderers: HitlRenderer[] = [
  {
    kind: 'ask',
    render: ({ interaction, submitting, keyboardActive, chrome, onAnswer, onDismiss }) => (
      <AskInteractionView
        key={interaction.request.id}
        interaction={interaction as Extract<PendingHitlInteraction, { kind: 'ask' }>}
        submitting={submitting}
        keyboardActive={keyboardActive}
        chrome={chrome}
        onSubmit={onAnswer}
        onDismiss={onDismiss}
      />
    ),
  },
  {
    kind: 'confirm',
    render: ({ interaction, submitting, keyboardActive, chrome, onAnswer, onDismiss }) => (
      <ConfirmInteractionView
        interaction={interaction as Extract<PendingHitlInteraction, { kind: 'confirm' }>}
        submitting={submitting}
        keyboardActive={keyboardActive}
        chrome={chrome}
        onSubmit={onAnswer}
        onDismiss={onDismiss}
      />
    ),
  },
  {
    kind: 'config_change',
    render: ({ interaction, submitting, keyboardActive, chrome, onAnswer, onDismiss }) => (
      <ConfigChangeInteractionView
        interaction={interaction as Extract<PendingHitlInteraction, { kind: 'config_change' }>}
        submitting={submitting}
        keyboardActive={keyboardActive}
        chrome={chrome}
        onSubmit={onAnswer}
        onDismiss={onDismiss}
      />
    ),
  },
  {
    kind: 'request_secret',
    render: ({ interaction, submitting, keyboardActive, chrome, onSubmitSecret, onDismiss }) => (
      <SecretInteractionView
        interaction={interaction as Extract<PendingHitlInteraction, { kind: 'request_secret' }>}
        submitting={submitting}
        keyboardActive={keyboardActive}
        chrome={chrome}
        onSubmit={onSubmitSecret}
        onDismiss={onDismiss}
      />
    ),
  },
]

export function ChatInteractionOverlay({
  interaction,
  submittingRequestId,
  keyboardActive,
  chrome,
  onAnswer,
  onSubmitSecret,
  onDismiss,
}: ChatInteractionOverlayProps) {
  if (!interaction) return null

  const renderer = renderers.find((item) => item.kind === interaction.kind)
  if (renderer)
    return renderer.render({
      interaction,
      submitting: submittingRequestId === interaction.request.id,
      keyboardActive,
      chrome,
      onAnswer,
      onSubmitSecret,
      onDismiss,
    })

  return null
}
