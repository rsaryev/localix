/**
 * The one Continue button — every surface that offers a resume point renders this, so the word,
 * the glyph and the "suggested next step" mark cannot differ between a plan and the next kind.
 *
 * Recommended by construction: it is shown only while nobody is working (`useConversationIdle`),
 * it is the safe expected step, and it grants nothing.
 */
import { Play } from 'lucide-react'
import type { ResumePoint } from '@localixai/api/client'
import { Button } from '@localixai/kit/button'

export function ContinueButton({
  point,
  busy,
  disabled,
  onContinue,
}: {
  point: ResumePoint
  busy: boolean
  disabled?: boolean
  onContinue: (point: ResumePoint) => void
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      recommended={!busy && !disabled}
      disabled={busy || disabled}
      title={`Ask the agent to continue ${point.title}`}
      onClick={() => onContinue(point)}
    >
      <Play data-icon="inline-start" aria-hidden />
      {busy ? 'Continuing…' : 'Continue'}
    </Button>
  )
}
