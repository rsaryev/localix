import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { textEncoderByteLength } from '../utils/hash'
import { prepareModelToolSchema } from '../utils/model-tool-schema'
import { zodToJsonSchema } from '../utils/zod-schema'
import { describeFixedContext, estimateToolSchemaTokens } from './tool-schema-tokens'

describe('estimateToolSchemaTokens', () => {
  test('charges a flat schema allowance per tool on top of name + description', () => {
    expect(estimateToolSchemaTokens([{ name: 'ab', description: 'cd' }])).toBe(65) // ceil(4/4) + 64
    expect(estimateToolSchemaTokens([{ name: 'ab' }, { name: 'cd' }])).toBe(2 * 65)
  })

  test('an empty toolset costs nothing', () => {
    expect(estimateToolSchemaTokens([])).toBe(0)
  })

  test('prices the prepared model-facing JSON schema instead of a flat allowance', () => {
    const tool = {
      name: 'lookup',
      description: 'Look up a record by its stable key.',
      inputSchema: z.object({
        key: z.string().describe('Stable record key'),
        filters: z
          .array(z.object({ field: z.string(), value: z.string() }))
          .describe('Optional exact-match filters'),
      }),
    }
    const parameters = prepareModelToolSchema(zodToJsonSchema(tool.inputSchema)).schema
    const expected = Math.ceil(
      textEncoderByteLength(
        JSON.stringify({
          name: tool.name,
          description: tool.description,
          parameters,
        }),
      ) / 4,
    )

    expect(estimateToolSchemaTokens([tool])).toBe(expected)
    expect(expected).toBeGreaterThan(64)
  })
})

describe('describeFixedContext', () => {
  test('prices the system prompt at ~4 UTF-8 bytes per token', () => {
    expect(describeFixedContext('x'.repeat(400), []).tokens).toBe(100)
    expect(describeFixedContext('你好🙂', []).promptTokens).toBe(3)
    expect(describeFixedContext(undefined, [{ name: 'ab', description: 'cd' }]).tokens).toBe(65)
  })

  test('splits the floor into prompt and tools and names the heaviest schemas first', () => {
    const big = {
      name: 'big',
      description: 'x'.repeat(4_000),
      inputSchema: z.object({ a: z.string() }),
    }
    const small = { name: 'small', description: 'y', inputSchema: z.object({}) }
    const described = describeFixedContext('system prompt text', [small, big])
    expect(described.tokens).toBe(described.promptTokens + described.toolTokens)
    expect(described.promptTokens).toBeGreaterThan(0)
    expect(described.heaviestTools.map((tool) => tool.name)).toEqual(['big', 'small'])
    expect(described.heaviestTools[0]!.tokens).toBeGreaterThan(1_000)
  })
})
