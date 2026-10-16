/**
 * `@human` inside a message — the one mention that is about the person reading it.
 *
 * Not a button, because there is nowhere to go: every other mention opens the participant's
 * profile, and the participant here is the reader. So it is a MARK, and it is the loudest one
 * in the transcript on purpose — a room that hands the turn back goes quiet, and the person has
 * to be able to find the sentence that stopped it while scrolling past three other replies.
 * Telegram marks a mention of you the same way and for the same reason.
 *
 * Inline at text size so the sentence still reads as a sentence.
 */
import { AtSign } from 'lucide-react'
import { MENTION_CHIP } from './mention-chip'

export function HumanMentionChip({ children }: { children?: React.ReactNode }) {
  return (
    <span className={MENTION_CHIP.self}>
      <AtSign className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{children ?? 'you'}</span>
    </span>
  )
}
