import { useCallback, useEffect } from 'react'
import type { ParsedContextRef } from '@localixai/api/context-refs'
import {
  promptHasToken,
  type MessageBindingDragPayload,
} from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { composerBus, composerInsertMatchesSession } from '@/shared/lib/composerBus'
import { contextRefsMissingFromComposerText, refFromContextBinding } from '../../model/sendRefs'
import type { MessageBinding } from '@/shared/api/contracts'

type ContextBindingLike = MessageBindingDragPayload | Extract<MessageBinding, { kind: 'context' }>

/** The two slices of `useContextRefs` this needs — pinning a structured ref, and dropping one. */
interface PinnedRefSink {
  addPinnedRef: (ref: ParsedContextRef) => void
  clearPinnedRefs: (keys?: readonly string[]) => void
}

/**
 * Where a dropped or linked context binding lands in the composer.
 *
 * The rule this owns is "a link has ONE representation". Anything carrying the binding
 * MIME — a file-tree row, a sessions row, a terminal tab, a tool-call card, the SQL
 * Output log — resolves here, and almost everything becomes a STRUCTURED pinned ref
 * rendered as a chip, with no token text inserted into the prompt at all. Two carve-outs,
 * both deliberate:
 *
 *  - a FILE drops as a link-only `@path` mention in the TEXT (only the path ever reaches
 *    the model; the composer paints it as an inline pill), and
 *  - an unparseable payload falls back to its raw token text rather than vanishing.
 *
 * Two kinds do not go through the token parser at all, because they carry content rather
 * than an addressable id:
 *  - `snippet` is inline content, clamped to the server's schema cap here — an over-cap
 *    snippet would fail the WHOLE send at request validation rather than spilling.
 *  - `message` is ids-only (`<sessionId>/<messageId>`), resolved server-side, so it
 *    re-expands fresh instead of freezing a stale copy of the message.
 *
 * The composerBus subscription routes NON-drag links (the message hover-row's Link
 * button) through this exact same path, so there is only ever one implementation of
 * "what does linking X do". It is gated on the target session: a request addressed to a
 * session is claimed only by THAT session's composer, and a session-less composer must
 * never swallow it.
 */
export function useMessageBindingDrop(
  activeSessionId: string | null,
  prompt: string,
  setPrompt: (v: string) => void,
  ctxRefs: PinnedRefSink,
) {
  const addMessageBinding = useCallback(
    (binding: ContextBindingLike) => {
      const { target } = binding
      if (target.kind === 'snippet') {
        const content = target.attributes?.content
        if (typeof content !== 'string' || !content) return
        ctxRefs.addPinnedRef(refFromContextBinding(binding))
        return
      }
      if (target.kind === 'message') {
        const sessionId = target.attributes?.sessionId
        const messageId = target.attributes?.messageId
        if (!sessionId || !messageId) return
        ctxRefs.addPinnedRef(refFromContextBinding(binding))
        return
      }

      const token = binding.target.token
      // Structured-first: session/project/terminal/call/task/resource drops pin a chip
      // (label enriched from the drag payload when the parser has none).
      if (target.kind !== 'file') {
        ctxRefs.addPinnedRef(refFromContextBinding(binding))
        return
      }
      // File mention (or an unparseable token): whole-token dedup — `includes()` would
      // false-positive on a substring (`@a.ts` inside `@a.ts.bak`) and silently swallow
      // the drop.
      setPrompt(
        promptHasToken(prompt, token)
          ? prompt
          : `${prompt.trimEnd()}${prompt.trim() ? ' ' : ''}${token} `,
      )
    },
    [prompt, setPrompt, ctxRefs],
  )

  // Non-drag links (the message Link action) arrive on the bus and take the SAME path.
  // Decline everything else — text/attachment inserts stay owned by useComposerPrefill.
  useEffect(
    () =>
      composerBus.subscribe((req) => {
        // PromptInput's action path owns context-bound immediate sends and their budget preflight.
        // Staging these refs as chips too would leak them into the user's next draft.
        if (req.submit) return false
        const bindings = (req.bindings ?? []).filter(
          (binding): binding is ContextBindingLike => binding.kind === 'context',
        )
        if (bindings.length === 0) return false
        if (!composerInsertMatchesSession(req.sessionId, activeSessionId)) return false
        // A returned queued/failed send already restores its exact text through
        // useComposerPrefill. Re-stage only refs that have no token in that text;
        // otherwise a second subscriber could duplicate the token/chip or
        // overwrite the text update with its stale prompt closure.
        for (const ref of contextRefsMissingFromComposerText(req.text, bindings)) {
          ctxRefs.addPinnedRef(ref)
        }
        return true
      }),
    [activeSessionId, ctxRefs],
  )

  // The mirror: a surface whose observation is gone takes its chip back. A pinned snippet's
  // ref key IS its token, so the retraction needs no lookup table.
  useEffect(
    () =>
      composerBus.subscribeRetract((req) => {
        if (!composerInsertMatchesSession(req.sessionId, activeSessionId)) return false
        ctxRefs.clearPinnedRefs(req.tokens)
        return true
      }),
    [activeSessionId, ctxRefs],
  )

  return addMessageBinding
}
