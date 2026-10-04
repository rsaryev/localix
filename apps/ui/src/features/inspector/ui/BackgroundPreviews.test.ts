import { describe, expect, test } from 'bun:test'

import { previewHostKey } from '../model/previewHosts'
import type { PreviewsBySession } from '../model/preview'
import { selectBackgroundPreviewHosts } from './BackgroundPreviews'

describe('background preview host selection', () => {
  test('keeps every live host reachable beyond the former eight-preview cap', () => {
    const tabs: PreviewsBySession = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [
        `session-${index}`,
        [
          {
            previewId: `http://localhost:${53000 + index}`,
            url: `http://localhost:${53000 + index}/index.html`,
            version: index + 1,
          },
        ],
      ]),
    )
    const live = Object.fromEntries(
      Object.entries(tabs).map(([sessionId, [entry]]) => [
        previewHostKey(sessionId, entry!.previewId),
        true,
      ]),
    )

    expect(selectBackgroundPreviewHosts(tabs, live, {})).toHaveLength(10)
    expect(selectBackgroundPreviewHosts(tabs, live, { [Object.keys(live)[3]!]: 1 })).toHaveLength(9)
  })
})
