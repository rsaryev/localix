import { expect, test } from 'bun:test'
import { createEditorHandle } from './editorHandle'

test('symbol jumps scroll smoothly and flash the clamped destination line', () => {
  const positions: { lineNumber: number; column: number }[] = []
  const revealed: number[] = []
  const flashes: number[] = []
  let focused = 0
  type Args = Parameters<typeof createEditorHandle>
  const monaco = { editor: { ScrollType: { Smooth: 1 } } } as unknown as Args[0]
  const editor = {
    setPosition: (position: { lineNumber: number; column: number }) => positions.push(position),
    revealLineInCenter: (line: number, scrollType: number) => {
      expect(scrollType).toBe(1)
      revealed.push(line)
    },
    focus: () => focused++,
  } as unknown as Args[1]
  const model = { getLineCount: () => 20 } as unknown as Args[2]
  const handle = createEditorHandle(
    monaco,
    editor,
    model,
    () => ({}),
    (line) => flashes.push(line),
  )

  handle.revealLine(4)
  handle.revealLine(100)
  expect(positions).toEqual([
    { lineNumber: 5, column: 1 },
    { lineNumber: 20, column: 1 },
  ])
  expect(revealed).toEqual([5, 20])
  expect(flashes).toEqual([5, 20])
  expect(focused).toBe(2)
})
