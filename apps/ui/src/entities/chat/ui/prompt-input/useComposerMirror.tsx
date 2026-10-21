/**
 * WHAT IS PAINTED BEHIND THE COMPOSER'S TEXT.
 *
 * The textarea holds the real, opaque glyphs. Behind it sits a mirror laid out with the same
 * metrics, and this hook decides what that mirror draws: a tinted pill under every `@`-token
 * that means something, and — when nothing is queued — the inline completion's ghost, which has
 * no glyphs of its own above it and so shows through as a hint.
 *
 * A hook rather than three `useMemo`s in the composer because it is one question with one
 * answer, and the composer had grown past the size this repository allows a file to reach by
 * accumulating exactly this kind of neighbouring detail
 * (`scripts/source-size-guard.test.ts`).
 *
 * It returns `undefined` when there is nothing to paint, which is the common case: the mirror is
 * not mounted at all for a draft with no `@` and no suggestion.
 */
import { useMemo, type ReactNode } from 'react'

import { ALL_MENTION_HANDLE } from '@localixai/agent/agents'

import { isMultiParticipant } from '@/shared/api/contracts'
import { InlineCompletionGhost } from '@localixai/kit/inline-completion-ghost'
import { renderMentionHighlight } from './mentionHighlight'

export function useComposerMirror(input: {
  /** The draft as typed. */
  prompt: string
  /** The inline completion showing after the caret, if any. */
  suggestionGhost?: string
  /** The conversation's participants — each handle is painted in its participant's colour. */
  participants: readonly { handle: string }[]
}): ((value: string) => ReactNode) | undefined {
  const { prompt, suggestionGhost, participants } = input
  // `@all` rides along with the participants because it addresses them and is answered like a
  // handle (`conversation-strategy.ts`) — a token that does something has to look like one.
  const handles = useMemo(
    () =>
      isMultiParticipant({ agents: participants })
        ? [...participants.map((member) => member.handle), ALL_MENTION_HANDLE]
        : [],
    [participants],
  )
  return useMemo(() => {
    if (!suggestionGhost && !prompt.includes('@')) return undefined
    return (value: string) => (
      <>
        {value.includes('@') ? renderMentionHighlight(value, handles) : value}
        {suggestionGhost ? <InlineCompletionGhost>{suggestionGhost}</InlineCompletionGhost> : null}
      </>
    )
  }, [suggestionGhost, prompt, handles])
}
