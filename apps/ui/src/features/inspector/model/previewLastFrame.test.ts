import { afterEach, describe, expect, test } from 'bun:test'
import {
  PREVIEW_FRAME_MAX_AGE_MS,
  forgetPreviewFrames,
  readPreviewFrame,
  rememberPreviewFrame,
} from './previewLastFrame'

const frame = (capturedAt: number) => ({
  src: `data:image/jpeg;base64,${capturedAt}`,
  width: 800,
  height: 600,
  capturedAt,
})

afterEach(forgetPreviewFrames)

describe('preview last-frame cache', () => {
  test('hands back the newest frame remembered for a url', () => {
    rememberPreviewFrame('http://localhost:3000/', frame(1_000))
    rememberPreviewFrame('http://localhost:3000/', frame(2_000))

    expect(readPreviewFrame('http://localhost:3000/', 2_500)?.capturedAt).toBe(2_000)
    expect(readPreviewFrame('http://localhost:4000/', 2_500)).toBeNull()
  })

  test('drops a frame too old to still describe the page', () => {
    rememberPreviewFrame('http://localhost:3000/', frame(0))

    expect(readPreviewFrame('http://localhost:3000/', PREVIEW_FRAME_MAX_AGE_MS + 1)).toBeNull()
    // Expiry evicts, so a later read cannot resurrect it by asking at an earlier clock.
    expect(readPreviewFrame('http://localhost:3000/', 1)).toBeNull()
  })

  test('evicts the least recently written preview past the cap', () => {
    for (let i = 1; i <= 5; i++) rememberPreviewFrame(`http://localhost:300${i}/`, frame(i))

    expect(readPreviewFrame('http://localhost:3001/', 10)).toBeNull()
    expect(readPreviewFrame('http://localhost:3005/', 10)?.capturedAt).toBe(5)
  })

  test('re-remembering a url keeps it from being evicted as the oldest', () => {
    for (let i = 1; i <= 4; i++) rememberPreviewFrame(`http://localhost:300${i}/`, frame(i))
    rememberPreviewFrame('http://localhost:3001/', frame(9))
    rememberPreviewFrame('http://localhost:3005/', frame(10))

    expect(readPreviewFrame('http://localhost:3001/', 20)?.capturedAt).toBe(9)
    expect(readPreviewFrame('http://localhost:3002/', 20)).toBeNull()
  })
})
