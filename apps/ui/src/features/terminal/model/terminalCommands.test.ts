import { describe, expect, it } from 'bun:test'
import { extractCommandText, extractOutputText, type BufferRow } from './terminalCommands'

function reader(rows: BufferRow[]) {
  return (n: number): BufferRow => rows[n] ?? { text: '', wrapped: false }
}
const plain = (text: string): BufferRow => ({ text, wrapped: false })
const cont = (text: string): BufferRow => ({ text, wrapped: true })

describe('extractCommandText', () => {
  it('strips the prompt from the first row via inputStartX', () => {
    const rows = [plain('~/proj $ npm test        '), plain('running…')]
    // Prompt "~/proj $ " is 9 chars → command starts at col 9, output at row 1.
    expect(extractCommandText(reader(rows), 0, 9, 1)).toBe('npm test')
  })

  it('stitches a soft-wrapped command back into one line (no newline)', () => {
    const rows = [plain('$ echo aaaaaaaaaa'), cont('bbbbbbbbbb'), plain('output')]
    expect(extractCommandText(reader(rows), 0, 2, 2)).toBe('echo aaaaaaaaaabbbbbbbbbb')
  })

  it('keeps a newline at a genuine logical break (multi-line command)', () => {
    const rows = [plain('$ git commit \\'), plain('  -m msg'), plain('done')]
    expect(extractCommandText(reader(rows), 0, 2, 2)).toBe('git commit \\\n  -m msg')
  })

  it('returns empty when the range is degenerate', () => {
    expect(extractCommandText(reader([plain('$ x')]), 0, 2, 0)).toBe('')
  })
})

describe('extractOutputText', () => {
  it('captures rows between C and D and trims trailing blanks', () => {
    const rows = [plain('$ ls'), plain('a.txt'), plain('b.txt'), plain('   '), plain('')]
    // output rows [1,4) → 'a.txt','b.txt','   '(trimmed) then trailing blank dropped
    expect(extractOutputText(reader(rows), 1, 4)).toBe('a.txt\nb.txt')
  })

  it('stitches wrapped output lines', () => {
    const rows = [plain('$ cat'), plain('longlinestart'), cont('longlineend')]
    expect(extractOutputText(reader(rows), 1, 3)).toBe('longlinestartlonglineend')
  })

  it('returns empty for a command with no output', () => {
    expect(extractOutputText(reader([plain('$ true'), plain('')]), 1, 1)).toBe('')
  })
})
