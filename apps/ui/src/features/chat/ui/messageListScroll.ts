import type { ChatVirtualMeasurement } from '@/shared/hooks/chatScrollState'

/**
 * The gap INSIDE a run of same-speaker messages.
 *
 * Between runs the gap is this plus the bottom padding a run's last card carries, which is
 * how a transcript says "someone else is speaking" without a line or a label. Keeping the
 * small value here and the difference on the card is what lets the virtualizer keep one
 * constant gap while the spacing still varies — a per-row gap is not something it can express,
 * but a per-row height is, and the card's padding is part of its height.
 */
export const CHAT_ROW_GAP = 10
export const CHAT_PAD_TOP = 48
export const CHAT_PAD_BOTTOM = 32
export const ESTIMATED_CHAT_ROW_HEIGHT = 220

/**
 * Best available bottom offset before TanStack Virtual has attached and measured
 * the live viewport. Cached row sizes improve the first paint, but a saved
 * reading-position never participates: opening a chat is an explicit navigation
 * and must start at its latest message.
 */
export function openedTranscriptBottomOffset(
  rowCount: number,
  viewportHeight: number,
  measurements: readonly ChatVirtualMeasurement[] = [],
): number {
  if (rowCount <= 0) return 0

  const measuredSizes = new Map<number, number>()
  for (const measurement of measurements) {
    if (
      measurement.index >= 0 &&
      measurement.index < rowCount &&
      Number.isFinite(measurement.size) &&
      measurement.size > 0
    ) {
      measuredSizes.set(measurement.index, measurement.size)
    }
  }

  let rowsHeight = 0
  for (let index = 0; index < rowCount; index += 1) {
    rowsHeight += measuredSizes.get(index) ?? ESTIMATED_CHAT_ROW_HEIGHT
  }
  const transcriptHeight =
    CHAT_PAD_TOP + rowsHeight + CHAT_ROW_GAP * Math.max(0, rowCount - 1) + CHAT_PAD_BOTTOM

  return Math.max(0, transcriptHeight - Math.max(0, viewportHeight))
}
