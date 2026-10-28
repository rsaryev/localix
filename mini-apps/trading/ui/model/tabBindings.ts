import {
  resourceMessageBindingDraft,
  type MessageContextBindingDraft,
  type WorkItemLike,
} from '@localixai/mini-app-sdk/ui'

import { buildTradeUri } from '../../backend/uri'
import { marketMessageBindingDraft } from './marketDrag'
import { normalizeChartPayload } from './openTab'

/**
 * What a trading tab drags into a chat message.
 *
 * Both builders normalize the payload FIRST, and that is the whole reason they live together
 * rather than inline in `register.tsx`: the rule they share is that a ref must name the connection
 * the tab is actually showing. It has been broken before — the render mapped an unflagged
 * credentialed `connectionId` onto the venue's public profile while the drag ref kept the raw id,
 * so a tab showing a public chart handed the agent a ref to an account-bearing connection. Two
 * functions with one invariant belong in one file, where the invariant can be stated once.
 */

/**
 * A technicals tab drags in as its market's `technicals` LEAF resource — the backend computes the
 * full rating (oscillator + MA votes, gauges, house lenses) on demand from freshly read candles,
 * so the agent gets the summary even if the tab was never opened.
 */
export function technicalsToMessageBinding(item: WorkItemLike): MessageContextBindingDraft | null {
  const symbol = item.payload?.symbol as string | undefined
  if (!symbol) return null
  const source = normalizeChartPayload(item.payload)
  const uri = buildTradeUri({
    kind: 'marketLeaf',
    connectionId: source.connectionId,
    symbol,
    leaf: 'technicals',
  })
  return resourceMessageBindingDraft({ uri, label: `${symbol} technicals` })
}

/** A chart tab drags in as its market's `localix://resource/trade/…` resource ref. */
export function chartToMessageBinding(item: WorkItemLike): MessageContextBindingDraft | null {
  const symbol = item.payload?.symbol as string | undefined
  if (!symbol) return null
  const source = normalizeChartPayload(item.payload)
  return marketMessageBindingDraft(source.connectionId, symbol)
}
