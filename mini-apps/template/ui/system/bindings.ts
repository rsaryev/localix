import {
  snippetMessageBindingDraft,
  type PublishedMessageContext,
} from '@localixai/mini-app-sdk/ui'
import { formatSystemSnapshot, type SystemSnapshot } from '../../shared/system'
import { formatProcessSnapshot, type ProcessSnapshot } from '../../shared/processes'

/** Publish exactly what the user sees, not an independently refreshed sample. */
export function systemMessageContext(
  snapshot: SystemSnapshot,
  stale = false,
  processes?: ProcessSnapshot | null,
): PublishedMessageContext {
  return {
    strategy: 'replace',
    bindings: [
      snippetMessageBindingDraft({
        label: 'System overview',
        language: 'text',
        content: [
          stale ? 'STALE: refresh failed; this is the last successful sample.' : '',
          formatSystemSnapshot(snapshot),
          processes ? formatProcessSnapshot(processes, 50) : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      }),
    ],
  }
}
