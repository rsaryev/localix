import { useEffect } from 'react'
import { resourceMessageBindingDraft, type PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { localixResourceUri } from '@localixai/mini-app-sdk/navigation'

/**
 * Publish a file tab's extracted `localix://resource/doc` identity as its message context, or
 * clear it while there is none — no extraction means no model-readable binding is claimed.
 */
export function usePublishDocContext(
  publishMessageContext: PublishMessageContext | undefined,
  contextId: string | undefined,
  label: string,
): void {
  useEffect(() => {
    if (!publishMessageContext) return
    if (!contextId) {
      publishMessageContext(null)
      return
    }
    publishMessageContext({
      strategy: 'replace',
      bindings: [
        resourceMessageBindingDraft({
          uri: localixResourceUri('doc', [contextId]),
          label,
        }),
      ],
    })
  }, [contextId, label, publishMessageContext])
}
