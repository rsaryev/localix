import { describe, expect, test } from 'bun:test'
import { terminalActionTitle } from './TerminalToolCard'

describe('terminalActionTitle', () => {
  test('uses plain IDE labels instead of platform-dependent keyboard emoji', () => {
    expect(terminalActionTitle('keys', undefined, ['CTRL+C'])).toBe('Keys: CTRL+C')
    expect(terminalActionTitle('type', undefined, [])).toBe('Type input')
    expect(terminalActionTitle('keys', undefined, ['ENTER'])).not.toContain('⌨')
  })
})
