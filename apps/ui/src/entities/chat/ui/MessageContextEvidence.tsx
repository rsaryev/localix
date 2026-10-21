import { isSystemContextSelectionBinding } from '@localixai/agent'
import type { MessageBinding, MessageContextBinding } from '@/shared/api/contracts'
import { MessageContextInspector } from './MessageContextInspector'

function feedback(binding: MessageContextBinding): { note: string; summary: string } | null {
  const attributes = binding.target.attributes
  if (
    attributes?.feedbackVersion === 1 &&
    typeof attributes.feedbackNote === 'string' &&
    typeof attributes.feedbackSummary === 'string'
  ) {
    return { note: attributes.feedbackNote, summary: attributes.feedbackSummary }
  }
  // Previous preview captures already persisted the formatter's immutable Markdown.
  // Only recognize that exact envelope, never guess from arbitrary snippet text.
  const content = binding.target.attributes?.content
  if (
    binding.target.kind !== 'snippet' ||
    typeof content !== 'string' ||
    !content.startsWith('**Preview feedback**') ||
    !content.includes('The user reviewed the live preview and left comments on these elements:')
  )
    return null
  const note = content.match(/(?:^|\n)((?:>[^\n]*(?:\n|$))+)/)?.[1]
  return note
    ? {
        summary: binding.target.label,
        note: note
          .trimEnd()
          .split('\n')
          .map((line) => line.replace(/^> ?/, ''))
          .join('\n'),
      }
    : null
}

/**
 * Under a sent message: human feedback stays visible as its own bubble; every other context is
 * one quiet summary that opens the inspector. Technical evidence is inspectable, never
 * conversation prose.
 */
export function MessageContextEvidence({
  bindings,
  sessionId,
}: {
  bindings?: readonly MessageBinding[]
  /** The session the message belongs to — where opening a context navigates within. */
  sessionId: string | null
}) {
  const context = (bindings ?? []).filter(
    (binding): binding is MessageContextBinding =>
      binding.kind === 'context' &&
      // The record of which workspace slots the person kept on is bookkeeping, not context: it
      // reaches the model empty by design. Listed, it read as "not included" (the warning
      // triangle) and its row asked the `@`-ref registry for a kind it does not have, which threw
      // and took the whole message down ("This message could not render").
      !isSystemContextSelectionBinding(binding),
  )
  if (!context.length) return null
  return (
    <div className="mt-1 flex w-full min-w-0 flex-col items-end gap-1.5">
      {context.map((binding) => {
        const review = feedback(binding)
        return review ? (
          <div
            key={binding.id}
            className="max-w-[min(85%,44rem)] min-w-0 rounded-2xl bg-surface-active px-4 py-3 text-sm text-foreground"
          >
            <div className="break-words text-xs font-medium text-text-soft">{review.summary}</div>
            <div className="mt-1 whitespace-pre-wrap break-words">{review.note}</div>
          </div>
        ) : null
      })}
      <MessageContextInspector bindings={context} sessionId={sessionId} />
    </div>
  )
}
