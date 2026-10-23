import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

import { reparseToolInput } from './reparse-input'

const tool = (inputSchema: unknown) => ({ name: 't', inputSchema }) as never

describe('reparseToolInput', () => {
  test('a zod schema re-parses the rewrite and returns the parsed value', () => {
    const schema = z.object({ n: z.coerce.number() })
    expect(reparseToolInput(tool(schema), { n: '2' })).toEqual({ ok: true, input: { n: 2 } })
  })

  test('a rewrite the schema refuses is rejected with its message', () => {
    const result = reparseToolInput(tool(z.object({ n: z.number() })), { n: 'x' })
    expect(result.ok).toBe(false)
  })

  test('a schema the host cannot parse accepts the rewrite as-is', () => {
    const json = { type: 'object', properties: {} }
    expect(reparseToolInput(tool(json), { a: 1 })).toEqual({ ok: true, input: { a: 1 } })
    expect(reparseToolInput(tool(undefined), 'raw')).toEqual({ ok: true, input: 'raw' })
  })
})
