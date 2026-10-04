import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { stringToArray, stringToInteger } from './tool-schema'
import { bashToolInputSchema } from './bash/bash-types'
import { readToolInputSchema } from './file/read'
import { askToolQuestionSchema } from './hitl/ask'

describe('stringToArray', () => {
  test('wraps a lone string — the 27x `bash.commands` rejection', () => {
    expect(stringToArray('npm test')).toEqual(['npm test'])
  })

  test('parses a JSON array-of-strings literal instead of wrapping it', () => {
    expect(stringToArray('["a", "b"]')).toEqual(['a', 'b'])
  })

  test('a bracket-leading string that is not JSON stays one element', () => {
    expect(stringToArray('[not json')).toEqual(['[not json'])
  })

  test('a JSON array of non-strings is not silently accepted', () => {
    expect(stringToArray('[1, 2]')).toEqual(['[1, 2]'])
  })

  test('a real array passes through untouched', () => {
    const arr = ['a']
    expect(stringToArray(arr)).toBe(arr)
  })
})

describe('stringToInteger', () => {
  test('converts a decimal-integer string', () => {
    expect(stringToInteger('12')).toBe(12)
    expect(stringToInteger(' -3 ')).toBe(-3)
  })

  test('leaves a non-integer string alone so zod reports the real type error', () => {
    expect(stringToInteger('abc')).toBe('abc')
    expect(stringToInteger('1.5')).toBe('1.5')
    const schema = z.preprocess(stringToInteger, z.number().int())
    expect(schema.safeParse('abc').success).toBe(false)
  })
})

describe('the tolerances are wired into the tools that needed them', () => {
  test('bash accepts a string `commands`', () => {
    const r = bashToolInputSchema.safeParse({ commands: 'npm test', description: 'Test' })
    expect(r.success && r.data.commands).toEqual(['npm test'])
  })

  test('read accepts a string `start_line`, rejects a junk one', () => {
    const ok = readToolInputSchema.safeParse({ path: 'x.ts', start_line: '12' })
    expect(ok.success && ok.data.start_line).toBe(12)
    expect(readToolInputSchema.safeParse({ path: 'x.ts', start_line: 'abc' }).success).toBe(false)
    // `.min(1)` still applies after the conversion.
    expect(readToolInputSchema.safeParse({ path: 'x.ts', start_line: '0' }).success).toBe(false)
  })

  test('read accepts a string `offset` — the field most likely to arrive as one', () => {
    // Its own description tells the model to reuse "the offset suggested in a previous truncated
    // read", i.e. to copy a number out of a text marker. `start_line` two fields away already
    // tolerated that; `offset` did not, so one schema answered the same input two ways.
    const ok = readToolInputSchema.safeParse({ path: 'x.ts', offset: '2048' })
    expect(ok.success && ok.data.offset).toBe(2048)
    expect(readToolInputSchema.safeParse({ path: 'x.ts', offset: 'abc' }).success).toBe(false)
    // `.min(0)` still applies after the conversion, and 0 stays legal.
    expect(readToolInputSchema.safeParse({ path: 'x.ts', offset: '-1' }).success).toBe(false)
    const zero = readToolInputSchema.safeParse({ path: 'x.ts', offset: '0' })
    expect(zero.success && zero.data.offset).toBe(0)
  })

  test('the ask tool accepts a string `recommended` index', () => {
    const build = (recommended: unknown) => ({
      id: 'q1',
      question: 'Which one?',
      // Options are objects ({label, value?, description?}), not bare strings.
      options: [{ label: 'a' }, { label: 'b' }],
      recommended,
    })
    const parsed = askToolQuestionSchema.safeParse(build('1'))
    expect(parsed.success && parsed.data.recommended).toBe(1)
    expect(askToolQuestionSchema.safeParse(build('abc')).success).toBe(false)
    // `.min(0)` survives the conversion.
    expect(askToolQuestionSchema.safeParse(build('-1')).success).toBe(false)
  })

  test('a signed integer field accepts a string, and its range still holds', () => {
    const schema = z.object({
      priority: z.preprocess(stringToInteger, z.number().int().min(-2).max(2)).optional(),
    })
    const ok = schema.safeParse({ priority: '-2' })
    expect(ok.success && ok.data.priority).toBe(-2)
    // A string cannot smuggle a value past `.min/.max` — the range applies after conversion.
    expect(schema.safeParse({ priority: '3' }).success).toBe(false)
    expect(schema.safeParse({ priority: 'x' }).success).toBe(false)
  })
})
