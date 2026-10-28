import {
  useEffect,
  useEffectEvent,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'

import {
  composerBus,
  composerInsertMatchesSession,
  type ComposerInsert,
} from '@/shared/lib/composerBus'
import { messageAttachmentToFile } from '@/shared/lib/attachments/file-staging'
import type { MessageAttachment } from '@/shared/api/contracts'

export function isStageableAttachment(
  binding: NonNullable<Parameters<typeof composerBus.insert>[0]['bindings']>[number],
): binding is MessageAttachment {
  // Context links are pinned as chips by `useMessageBindingDrop`, and an invocation is carried by
  // the text it was typed as: neither is a file to stage. A `path` attachment is: it re-enters the
  // pipeline untouched, still a by-path reference to the file the person dropped.
  if (binding.kind === 'context' || binding.kind === 'invocation') return false
  if (binding.kind === 'path') return true
  // `messageAttachmentToFile` retains a mediaId-only asset in a WeakMap, so the
  // normal attachment pipeline can re-stage it without fabricating or re-uploading bytes.
  return binding.kind === 'text' || Boolean(binding.data || binding.mediaId)
}

export interface ComposerPrefillDeps {
  composerRef: RefObject<HTMLDivElement | null>
  setPrompt: Dispatch<SetStateAction<string>>
  addFiles: (files: File[]) => void | Promise<void>
  /** This composer's session — it accepts only inserts addressed to it, focused or not. */
  sessionId?: string | null
  /** Send text through the chat pipeline immediately — the `submit` insert's path, with the
   *  composer's normal send semantics (staged attachments ride along, the draft clears).
   *  `internal` marks the turn hidden (machine-composed prompt). */
  send?: (text: string, internal?: boolean) => void
}

/**
 * The draft with `text` added to it.
 *
 * TWO KINDS OF INSERT, and they need different seams. A quoted passage or a staged command is
 * its own paragraph, so it arrives after a blank line. A mod's fill is a WORD or phrase in the
 * sentence the person is writing: several of them separated by blank lines made a column instead
 * of one line. `inline` says which, and the caller knows — the text
 * itself cannot be asked.
 *
 * Whitespace is never doubled at the seam: fills may carry a trailing space so the sentence
 * continues, and a second click must not add another.
 */
export function appendToDraft(
  draft: string,
  text: string,
  req: Pick<ComposerInsert, 'replace' | 'inline'>,
): string {
  if (req.replace || !draft.trim()) return text
  if (!req.inline) return `${draft}\n\n${text}`
  return /\s$/u.test(draft) ? `${draft}${text}` : `${draft} ${text}`
}

/** Context-bound immediate sends must be budgeted by PromptInput before they enter chat. */
export function needsContextBoundSubmit(req: ComposerInsert): boolean {
  return Boolean(
    req.submit && req.text && req.bindings?.some((binding) => binding.kind === 'context'),
  )
}

/**
 * Agnostic composer prefill — any feature (code/preview comments, deep
 * links, …) can drop text + bindings into the input via `composerBus`; we
 * apply it here and focus the textarea. Extracted from ChatSurface.
 *
 * Every insert names its chat and targets ONE composer: surfaces for other
 * sessions decline it (return `false`) so the bus can keep a buffered insert
 * pending until the addressed composer mounts. Focus never decides — accepting
 * whatever the focused composer was offered put one chat's insert in another's draft.
 */
export function useComposerPrefill({
  composerRef,
  setPrompt,
  addFiles,
  sessionId,
  send,
}: ComposerPrefillDeps): void {
  // The send handler closes over the live prompt/bindings and changes every render — read it
  // through an effect event so the bus subscription itself stays put.
  const latestSend = useEffectEvent(() => send)
  useEffect(
    () =>
      composerBus.subscribe((req) => {
        const send = latestSend()
        if (!composerInsertMatchesSession(req.sessionId, sessionId)) return false
        if (needsContextBoundSubmit(req)) return false
        if (req.submit && req.text && send) {
          // A submit insert skips staging: the text goes straight through the send pipeline
          // as an override, with the composer's normal send semantics.
          send(req.text, req.internal)
          return
        }
        if (req.text) {
          setPrompt((prev) => appendToDraft(prev, req.text!, req))
        }
        const assets = (req.bindings ?? []).filter(isStageableAttachment)
        if (!req.text && assets.length === 0) return false
        if (assets.length) void addFiles(assets.map(messageAttachmentToFile))
        if (req.focus !== false) composerRef.current?.querySelector('textarea')?.focus()
      }),
    [composerRef, setPrompt, addFiles, sessionId],
  )
}
