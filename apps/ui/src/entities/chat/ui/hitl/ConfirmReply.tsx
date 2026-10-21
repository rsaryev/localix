import { useEffect, useRef } from 'react'
import { MessageSquareReply } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { Textarea } from '@localixai/kit/textarea'

/**
 * Words sent back WITH the answer — "no, read `src/theme.ts` instead".
 *
 * Without it a refusal reached the agent as "User declined read." and nothing else. A sub-agent
 * that had picked the wrong file could only guess again, or give up, and the person watching
 * had no way to steer it short of opening its chat. The reply rides the same answer as the
 * verdict (`ConfirmToolResponsePayload.message`), so it arrives in the very tool result the
 * agent is waiting on — no second message, no race with the next call.
 *
 * Collapsed until asked for: most answers are a bare yes or no, and an always-open field would
 * also take the Enter key away from the card. Collapsed, it is one small button in the footer
 * beside the answers it rides with — as a row of its own in the body it was the third labelled
 * line of a card that should read as one question.
 */
export function ConfirmReplyButton({
  onOpen,
  addressee,
  disabled,
}: {
  onOpen: () => void
  /** Who reads it: "agent" or "sub-agent". */
  addressee: string
  disabled?: boolean
}) {
  // An icon, not a labelled button: beside the deadline and both answers, a word here pushed
  // Approve onto a second line on a card the width of the chat column.
  return (
    <IconButton
      size="lg"
      disabled={disabled}
      onClick={onOpen}
      tooltip={`Reply to the ${addressee}`}
      aria-label={`Reply to the ${addressee}`}
    >
      <MessageSquareReply className="size-3.5" />
    </IconButton>
  )
}

/** The open field: focused as it appears, so the click that opened it is the start of typing. */
export function ConfirmReply({
  value,
  onChange,
  addressee,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  /** Who reads it: "agent" or "sub-agent". */
  addressee: string
  disabled?: boolean
}) {
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    fieldRef.current?.focus()
  }, [])

  return (
    <div className="space-y-1">
      <Textarea
        ref={fieldRef}
        value={value}
        disabled={disabled}
        maxLength={2000}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // Hand Escape back to the card: the field is a typing target, so the card's own
          // shortcut stands aside while it has focus, and a second Escape then denies.
          if (event.key === 'Escape') {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
        placeholder={`What should the ${addressee} do instead?`}
        aria-label={`Reply to the ${addressee}`}
        className="min-h-14"
      />
      <p className="text-2xs text-text-faint">Sent with your answer, Deny or Approve.</p>
    </div>
  )
}
