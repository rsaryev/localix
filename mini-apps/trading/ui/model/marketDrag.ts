import {
  resourceMessageBindingDraft,
  type MessageContextBindingDraft,
} from '@localixai/mini-app-sdk/ui'

import { setMessageBindingDrag } from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { buildTradeUri } from '../../backend/uri'

export function marketResourceUri(connectionId: string, symbol: string): string {
  return buildTradeUri({ kind: 'market', connectionId, symbol })
}

/** One canonical agent-link for a market, shared by tab contributions and market rows. */
export function marketMessageBindingDraft(
  connectionId: string,
  symbol: string,
  source: MessageContextBindingDraft['source'] = 'mini-app',
): MessageContextBindingDraft {
  return resourceMessageBindingDraft(
    {
      uri: marketResourceUri(connectionId, symbol),
      label: symbol,
    },
    source,
  )
}

/**
 * Arm the shared message-binding transport used by every agent-linkable drag.
 *
 * The structured MIME drives the composer's standardized resource drop effect;
 * the opted-in text/plain keeps the native gesture alive in WebKit/WebView and is
 * a useful fallback outside Localix.
 */
export function setMarketMessageBindingDrag(
  dataTransfer: DataTransfer,
  connectionId: string,
  symbol: string,
): void {
  const binding = marketMessageBindingDraft(connectionId, symbol, 'drag')
  setMessageBindingDrag(dataTransfer, binding, {
    previewLabel: symbol,
    plainText: binding.target.token,
  })
}
