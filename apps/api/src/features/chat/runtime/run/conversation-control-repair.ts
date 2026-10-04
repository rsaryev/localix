import type { AgentItem } from '@localixai/agent/agents'

import type { StoredMessagePayload } from '../../../../db'

const isMeaningfulText = (item: AgentItem): item is Extract<AgentItem, { type: 'text' }> =>
  item.type === 'text' && item.text.trim().length > 0

/**
 * A missing required `conversation_control` creates a host-requested repair turn. Providers sometimes
 * repeat the whole answer in that turn, and sometimes emit only whitespace before the tool call.
 * In both cases the stored assistant row must contain one public draft:
 *
 * - meaningful repair prose replaces the earlier draft;
 * - an empty repair keeps the earlier draft;
 * - reasoning and tool items remain intact for the authoring AgentLane.
 */
export function settleConversationControlRepair(
  payload: StoredMessagePayload,
  repairTurn: number | undefined,
): StoredMessagePayload {
  if (repairTurn === undefined || !payload.items?.length) return payload

  const repairText = payload.items.filter(
    (item) => item.type === 'text' && (item.turnIndex ?? -1) >= repairTurn,
  )
  const meaningfulRepair = repairText.filter(isMeaningfulText)
  const useRepair = meaningfulRepair.length > 0
  const latestRepairTurn = useRepair
    ? Math.max(...meaningfulRepair.map((item) => item.turnIndex ?? repairTurn))
    : undefined
  const selectedText = useRepair
    ? meaningfulRepair.filter((item) => (item.turnIndex ?? repairTurn) === latestRepairTurn)
    : payload.items.filter(
        (item): item is Extract<AgentItem, { type: 'text' }> =>
          isMeaningfulText(item) && (item.turnIndex ?? -1) < repairTurn,
      )
  const selectedIds = new Set(selectedText.map((item) => item.id))
  const items = payload.items.filter((item) => item.type !== 'text' || selectedIds.has(item.id))
  const content = selectedText.map((item) => item.text).join('')

  return { ...payload, content, items }
}
