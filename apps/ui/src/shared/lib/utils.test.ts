import { describe, expect, test } from 'bun:test'
import { clamp, cn } from '@localixai/plugin-sdk/ui/classes'
import { formatFileSize } from '@localixai/plugin-sdk/ui/utilities'

describe('formatFileSize', () => {
  test('bytes under 1KB', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(1023)).toBe('1023 B')
  })
  test('KB as a whole number', () => {
    expect(formatFileSize(1024)).toBe('1 KB')
    expect(formatFileSize(1536)).toBe('2 KB') // 1.5 → rounded
    expect(formatFileSize(1024 * 1024 - 1)).toBe('1024 KB')
  })
  test('MB with one decimal', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB')
  })
})

describe('cn', () => {
  test('merges conflicting Tailwind utilities (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-sm text-text-faint', 'text-foreground')).toBe('text-sm text-foreground')
  })
  test('drops falsy conditional classes', () => {
    const show: boolean = false // runtime-false, not a literal (keeps no-constant-binary-expression happy)
    expect(cn('a', show && 'b', undefined, null, 'c')).toBe('a c')
  })
})

describe('clamp', () => {
  test('constrains to the inclusive range', () => {
    expect(clamp(50, 0, 100)).toBe(50)
    expect(clamp(-10, 0, 100)).toBe(0)
    expect(clamp(230, 0, 100)).toBe(100)
    expect(clamp(0, 0, 100)).toBe(0)
    expect(clamp(100, 0, 100)).toBe(100)
  })
})
