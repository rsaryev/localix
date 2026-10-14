import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/** The consoles whose Run/Stop/tool buttons used to be transcribed class strings. */
const CONSOLES = [
  './sql-console/RunBar.tsx',
  './sql-console/TxControls.tsx',
  './SqlFilePanel.tsx',
  './DocConsole.tsx',
  './KvConsole.tsx',
]

/**
 * A padding-sized button (`px-2 py-1`, `px-2.5 py-1`) is the shape each console hand-rolled: it
 * took its height from padding rather than a control rung, so the run bar sat off every other
 * `xs` control, and Stop was drawn two different ways.
 */
const PADDING_SIZED_BUTTON = /rounded-md[^"'`]*\bpx-2(?:\.5)? py-1\b/u

describe('console actions come from one place', () => {
  test('no console transcribes a padding-sized button', () => {
    for (const file of CONSOLES) {
      expect({ file, hit: PADDING_SIZED_BUTTON.exec(read(file))?.[0] ?? null }).toEqual({
        file,
        hit: null,
      })
    }
  })

  test('every console with a Stop uses the shared one', () => {
    for (const file of [
      './sql-console/RunBar.tsx',
      './SqlFilePanel.tsx',
      './DocConsole.tsx',
      './KvConsole.tsx',
    ]) {
      expect({ file, shared: read(file).includes('<StopButton') }).toEqual({ file, shared: true })
    }
  })

  test('the detector fires on the shape it forbids (positive control)', () => {
    expect(
      PADDING_SIZED_BUTTON.test(
        'className="flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs font-medium"',
      ),
    ).toBe(true)
    expect(PADDING_SIZED_BUTTON.test('rounded-md bg-foreground px-2.5 py-1 text-2xs')).toBe(true)
    expect(PADDING_SIZED_BUTTON.test('<Button size="xs" variant="ghost">')).toBe(false)
  })
})
