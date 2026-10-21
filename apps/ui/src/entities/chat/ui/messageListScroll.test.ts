import { describe, expect, it } from 'bun:test'
import type { ChatVirtualMeasurement } from '@/shared/hooks/chatScrollState'
import {
  CHAT_PAD_BOTTOM,
  CHAT_PAD_TOP,
  CHAT_ROW_GAP,
  ESTIMATED_CHAT_ROW_HEIGHT,
  openedTranscriptBottomOffset,
} from './messageListScroll'

function measurement(index: number, size: number): ChatVirtualMeasurement {
  return { index, key: index, start: 0, size, end: size, lane: 0 }
}

describe('openedTranscriptBottomOffset', () => {
  it('starts a newly opened history at the estimated tail instead of scrollTop zero', () => {
    const rowCount = 12
    const viewportHeight = 600
    const transcriptHeight =
      CHAT_PAD_TOP +
      rowCount * ESTIMATED_CHAT_ROW_HEIGHT +
      (rowCount - 1) * CHAT_ROW_GAP +
      CHAT_PAD_BOTTOM

    expect(openedTranscriptBottomOffset(rowCount, viewportHeight)).toBe(
      transcriptHeight - viewportHeight,
    )
    expect(openedTranscriptBottomOffset(rowCount, viewportHeight)).toBeGreaterThan(0)
  })

  it('uses cached row measurements for a more accurate first bottom position', () => {
    // Rows tall enough to overflow the viewport: the point is that the CACHED sizes are
    // summed rather than the estimate, and a transcript that fits has no bottom offset to
    // compute (the clamp below is the case for that).
    expect(openedTranscriptBottomOffset(2, 500, [measurement(0, 300), measurement(1, 400)])).toBe(
      CHAT_PAD_TOP + 300 + CHAT_ROW_GAP + 400 + CHAT_PAD_BOTTOM - 500,
    )
  })

  it('clamps short and empty histories to scrollTop zero', () => {
    expect(openedTranscriptBottomOffset(0, 500)).toBe(0)
    expect(openedTranscriptBottomOffset(1, 500, [measurement(0, 100)])).toBe(0)
  })
})
