import { describe, expect, test } from 'bun:test'
import { isValidUiLocationParamSchema } from '@localixai/plugin-sdk/ui'
import fileOpen from './FileTab.surface'

describe('file.open — the agent can point at an exact span', () => {
  test('a line alone reveals that line', () => {
    expect(fileOpen.resolve({ path: 'src/a.ts', line: 4 })).toEqual({
      kind: 'file',
      path: 'src/a.ts',
      line: 4,
    })
  })

  test('line+column to end_line+end_column selects the span', () => {
    expect(
      fileOpen.resolve({ path: 'src/a.ts', line: 4, column: 40, end_line: 4, end_column: 47 }),
    ).toEqual({ kind: 'file', path: 'src/a.ts', line: 4, column: 40, endLine: 4, endColumn: 47 })
  })

  test('positions without a line are ignored rather than guessed', () => {
    expect(fileOpen.resolve({ path: 'src/a.ts', column: 3, end_column: 9 })).toEqual({
      kind: 'file',
      path: 'src/a.ts',
    })
  })

  test('the presentation names a multi-line selection', () => {
    expect(fileOpen.present?.({ path: 'src/a.ts', line: 4, end_line: 9 })).toMatchObject({
      description: 'Select lines 4–9',
    })
  })

  test('its params pass the location contract, so the surface registers at all', () => {
    // camelCase keys failed `[a-z][a-z0-9_-]*` and took the whole surface catalog down at startup.
    expect(isValidUiLocationParamSchema(fileOpen.params)).toBe(true)
  })
})
