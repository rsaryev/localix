import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { terminalActionTitle } from './TerminalToolCard'

const source = readFileSync(new URL('./TerminalToolCard.tsx', import.meta.url), 'utf8')

describe('terminalActionTitle', () => {
  test('uses plain IDE labels instead of platform-dependent keyboard emoji', () => {
    expect(terminalActionTitle('keys', undefined, ['CTRL+C'])).toBe('Keys: CTRL+C')
    expect(terminalActionTitle('type', undefined, [])).toBe('Type input')
    expect(terminalActionTitle('keys', undefined, ['ENTER'])).not.toContain('⌨')
  })

  test('keeps the terminal screen free of nested surface fills', () => {
    expect(source).not.toContain('bg-surface-raised')
    expect(source).not.toContain('rounded-md bg-')
  })
})
