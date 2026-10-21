import { useEffect } from 'react'

import type { MessageBinding } from '@/shared/api/contracts'
import { composerBus, composerInsertMatchesSession } from '@/shared/lib/composerBus'
import { toast } from '@/shared/lib/notify'
import type { MessageContextBindingDraft } from '@localixai/plugin-sdk/ui'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

import type { useContextRefs } from '../../model/useContextRefs'

type BindingsForSend = ReturnType<typeof useContextRefs>['bindingsForSend']

/**
 * A surface outside the composer (the Reader's "ask about this passage") submits a message
 * with context bindings through `composerBus`. It is claimed here, by the composer of the
 * addressed session, so the bindings go through the SAME budget preflight a typed send does
 * rather than reaching the model unmeasured.
 *
 * `bindingsForSend` must be the stable callback, not the context-refs object: that object is
 * fresh every render, and depending on it would tear down and re-arm the subscription on each
 * keystroke.
 */
export function useComposerBusSubmit(input: {
  activeSessionId: string | null
  bindingsForSend: BindingsForSend
  onSend: (textOverride?: string, bindings?: MessageBinding[], isInternal?: boolean) => void
  readOnly: boolean
  readOnlyReason: string | undefined
}) {
  const { activeSessionId, bindingsForSend, onSend, readOnly, readOnlyReason } = input
  useEffect(
    () =>
      composerBus.subscribe((request) => {
        if (!request.submit || !request.text) return false
        const bindings = (request.bindings ?? []).filter(
          (binding): binding is MessageContextBindingDraft => binding.kind === 'context',
        )
        if (bindings.length === 0) return false
        if (!composerInsertMatchesSession(request.sessionId, activeSessionId)) {
          return false
        }
        if (readOnly) {
          toast.error('Could not send the Reader context', {
            description: readOnlyReason ?? 'This conversation is read-only.',
          })
          return true
        }
        void (async () => {
          const refs = await bindingsForSend(bindings)
          if (refs === null) {
            toast.error('Could not send the Reader context', {
              description:
                'It is too large for the model window. Narrow the action to a chapter or visible passage.',
            })
            return
          }
          onSend(request.text, refs.length > 0 ? refs : undefined, request.internal)
        })().catch((error) =>
          toast.error('Could not prepare the Reader context for this message', {
            description: errorMessage(error, '') || undefined,
          }),
        )
        return true
      }),
    [activeSessionId, bindingsForSend, onSend, readOnly, readOnlyReason],
  )
}
