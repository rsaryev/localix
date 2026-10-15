import { expect, test } from 'bun:test'
import { resetTerminalOutput, retainTerminalOutput, terminalOutput } from './terminalOutput'

test('keeps final output across pane remounts and replaces it on a fresh replay', () => {
  retainTerminalOutput('failed', 'Starting\r\n')
  retainTerminalOutput('failed', 'Error: missing configuration\r\n')
  expect(terminalOutput('failed')).toBe('Starting\r\nError: missing configuration\r\n')
  resetTerminalOutput('failed')
  retainTerminalOutput('failed', 'New replay\r\n')
  expect(terminalOutput('failed')).toBe('New replay\r\n')
  resetTerminalOutput('failed')
})

test('bounds both a single large chunk and the number of retained terminals', () => {
  retainTerminalOutput('large', 'x'.repeat(300_000))
  retainTerminalOutput('large', '\r\nFinal error')
  expect(terminalOutput('large')!.length).toBeLessThanOrEqual(256 * 1024)
  expect(terminalOutput('large')).toEndWith('Final error')
  for (let n = 0; n < 16; n++) retainTerminalOutput(`cache-${n}`, `output ${n}`)
  expect(terminalOutput('large')).toBeUndefined()
  for (let n = 0; n < 16; n++) resetTerminalOutput(`cache-${n}`)
})

test('a full buffer of small writes keeps exactly the newest output, in order', () => {
  const chunk = (n: number) => `${String(n).padStart(7, '0')}\n`
  for (let n = 0; n < 100_000; n++) retainTerminalOutput('stream', chunk(n))
  const kept = terminalOutput('stream')!
  expect(kept.length).toBe(256 * 1024)
  expect(kept).toEndWith(chunk(99_999))
  expect(kept.startsWith(chunk(100_000 - (256 * 1024) / 8))).toBe(true)
  resetTerminalOutput('stream')
})
