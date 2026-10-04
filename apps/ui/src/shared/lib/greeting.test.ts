import { describe, expect, test } from 'bun:test'
import { timeGreeting, firstNameOf } from './greeting'

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

describe('firstNameOf', () => {
  test('returns the first word of a full name', () => {
    expect(firstNameOf('Roman Saryev')).toBe('Roman')
  })
  test('collapses surrounding + interior whitespace', () => {
    expect(firstNameOf('  Roman   Saryev  ')).toBe('Roman')
  })
  test('single name passes through', () => {
    expect(firstNameOf('Roman')).toBe('Roman')
  })
  test('empty / whitespace / null / undefined → empty string', () => {
    expect(firstNameOf('')).toBe('')
    expect(firstNameOf('   ')).toBe('')
    expect(firstNameOf(null)).toBe('')
    expect(firstNameOf(undefined)).toBe('')
  })
})
