import type { AgentIdentity } from '@/shared/contrib/useAgentIdentity'
import { AUTHOR_BODY_INDENT, MessageAuthorLine } from './MessageAuthorLine'
import { TypingStatus } from './TypingStatus'

interface MessageSkeletonProps {
  /**
   * Real activity label — either a backend phase ("Generating title") or the
   * derived verb ("Working", "Reading"). Shown on one stable status line.
   */
  label: string
  /**
   * Who is about to speak. Present from the moment the row exists, which is the point: the
   * reader sees the agent's name before the first character lands, not after.
   */
  author?: AgentIdentity | null
  triggerLabel?: string
}

/**
 * Shown in the assistant slot before the first token arrives: a single-line
 * typing status (Working / Connecting / Generating title / …). Replaced by real
 * content the moment any text/reasoning/tool item streams.
 */
export function MessageSkeleton({ label, author, triggerLabel }: MessageSkeletonProps) {
  // Strip any trailing … — TypingStatus adds its own once the word is typed.
  const clean = label.replace(/[….]+$/, '').trim() || 'Working'

  return (
    <article className="group flex w-full flex-col items-start pl-1" aria-busy="true">
      {/* No clock yet: the row is not persisted, so it has no time to tell. The name
          arrives now and the time joins it when the reply settles. */}
      {author && <MessageAuthorLine author={author} clock="" triggerLabel={triggerLabel} />}
      <div className={author ? AUTHOR_BODY_INDENT : undefined}>
        <TypingStatus label={clean} />
      </div>
    </article>
  )
}
