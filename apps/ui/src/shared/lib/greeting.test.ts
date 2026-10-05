import { describe, expect, test } from 'bun:test'
import { timeGreeting } from './greeting'

describe('timeGreeting', () => {
  const at = (h: number) => timeGreeting(new Date(2026, 0, 1, h, 30, 0))

  test('morning 5–11', () => {
    expect(at(5)).toBe('Good morning')
    expect(at(11)).toBe('Good morning')
  })
  test('afternoon 12–16', () => {
    expect(at(12)).toBe('Good afternoon')
    expect(at(16)).toBe('Good afternoon')
  })
  test('evening 17–21', () => {
    expect(at(17)).toBe('Good evening')
    expect(at(21)).toBe('Good evening')
  })
  test('night 22–4 (wraps midnight)', () => {
    expect(at(22)).toBe('Good night')
    expect(at(0)).toBe('Good night')
    expect(at(4)).toBe('Good night')
  })
})
