import {
  resourceMessageBindingDraft,
  type PublishedMessageContext,
} from '@localixai/mini-app-sdk/ui'
import { buildTradeUri } from '../../backend/uri'

/**
 * The chart's one current model-facing view.
 *
 * A timeframe-specific candle resource is a refinement of the tab's static
 * market resource, not a second independent facet. Publishing it as `replace`
 * keeps one tab represented by one link while preserving the exact horizon the
 * user is looking at.
 */
export function chartMessageContext(
  connectionId: string,
  symbol: string,
  timeframe: string,
): PublishedMessageContext {
  return {
    strategy: 'replace',
    bindings: [
      resourceMessageBindingDraft({
        uri: buildTradeUri({
          kind: 'marketLeaf',
          connectionId,
          symbol,
          leaf: 'candles',
          timeframe,
        }),
        label: `${symbol} ${timeframe} candles`,
      }),
    ],
  }
}
