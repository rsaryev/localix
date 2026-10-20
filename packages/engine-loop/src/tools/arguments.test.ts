import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { zodToJsonSchema } from '@localixai/agent'

import { parseToolArguments, unwrapParameters } from './arguments'
import type { JsonSchema } from './coerce'

function parse(schema: z.ZodType, raw: unknown) {
  return parseToolArguments({
    toolName: 'probe',
    raw,
    schema,
    jsonSchema: zodToJsonSchema(schema) as JsonSchema,
  })
}
function value(schema: z.ZodType, raw: unknown) {
  const parsed = parse(schema, raw)
  if (!parsed.ok) throw new Error(parsed.message)
  return parsed.value
}
function message(schema: z.ZodType, raw: unknown) {
  const parsed = parse(schema, raw)
  if (parsed.ok) throw new Error('expected a validation failure')
  return parsed.message
}

const targetSchema = z.object({
  target: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('summary') }),
      z.object({ kind: z.literal('agent'), name: z.string() }),
    ])
    .optional(),
})

describe('arguments a model sent as JSON strings', () => {
  test('a stringified discriminated-union object is parsed into the branch it names', () => {
    expect(value(targetSchema, { target: '{"kind":"agent","name":"researcher"}' })).toEqual({
      target: { kind: 'agent', name: 'researcher' },
    })
  })

  test('a stringified array is parsed, and its items keep their own coercion', () => {
    const schema = z.object({ commands: z.array(z.string()), counts: z.array(z.number()) })
    expect(value(schema, { commands: '["ls","pwd"]', counts: '["1","2"]' })).toEqual({
      commands: ['ls', 'pwd'],
      counts: [1, 2],
    })
  })

  test('a nested object inside a stringified object is coerced too', () => {
    const schema = z.object({
      change: z.object({ kind: z.string(), limits: z.object({ n: z.number() }) }),
    })
    expect(value(schema, { change: '{"kind":"agent.update","limits":{"n":"7"}}' })).toEqual({
      change: { kind: 'agent.update', limits: { n: 7 } },
    })
  })

  test('a call that already fits is never rewritten', () => {
    const raw = { target: { kind: 'summary' } }
    expect(value(targetSchema, raw)).toEqual({ target: { kind: 'summary' } })
  })

  test('prose is not a stringified object: the real type error stands', () => {
    expect(message(targetSchema, { target: 'the researcher agent' })).toContain(
      'target: must be object',
    )
  })

  test('JSON that parses but fits no branch still fails', () => {
    expect(parse(targetSchema, { target: '{"kind":"nope"}' }).ok).toBe(false)
  })

  test('null on an optional field means absent; scalars coerce', () => {
    const schema = z.object({ limit: z.number().optional(), flag: z.boolean() })
    expect(value(schema, { limit: null, flag: 'true' })).toEqual({ flag: true })
  })

  test("the tool's own preprocessing and defaults apply", () => {
    const schema = z.preprocess(
      (raw) =>
        typeof raw === 'object' && raw && 'file' in raw
          ? { path: (raw as { file: string }).file }
          : raw,
      z.object({ path: z.string(), mode: z.string().default('full') }),
    )
    expect(value(schema, { file: 'a.ts' })).toEqual({ path: 'a.ts', mode: 'full' })
  })
})

describe('the message a model repairs its call from', () => {
  const steps = z.strictObject({
    steps: z.array(z.strictObject({ action: z.enum(['click', 'press']), ref: z.string() })),
  })

  test('an unknown key is named once, as a parameter that is not accepted', () => {
    const text = message(steps, { steps: [{ action: 'click', ref: 'e1', snapshot_after: true }] })
    expect(text).toContain('steps.0: unknown parameter "snapshot_after" — not accepted here')
    expect(text).toContain('Received arguments:')
  })

  test('an enum miss lists the values it allows', () => {
    expect(message(steps, { steps: [{ action: 'wait', ref: 'e1' }] })).toContain(
      'steps.0.action: must be one of "click", "press"',
    )
  })

  const entry = z.strictObject({ title: z.string(), link: z.string().nullable() })
  const actions = z.discriminatedUnion('action', [
    z.strictObject({ action: z.literal('guide') }),
    z.strictObject({ action: z.literal('init'), title: z.string(), entries: z.array(entry) }),
    z.strictObject({
      action: z.literal('update'),
      operations: z.array(
        z.discriminatedUnion('op', [
          z.strictObject({ op: z.literal('rename'), title: z.string() }),
          z.strictObject({ op: z.literal('add'), entry }),
        ]),
      ),
    }),
  ])

  test('only the branch the call names is reported', () => {
    const text = message(actions, { action: 'init', title: 'CV', entries: [{ title: 'Go' }] })
    expect(text).toContain('entries.0.link')
    expect(text).not.toContain('not accepted here')
  })

  test('nested discriminated unions inside arrays narrow as well', () => {
    expect(
      message(actions, { action: 'update', operations: [{ op: 'add', entry: { title: 'Go' } }] }),
    ).toContain('operations.0.entry.link')
  })

  test('an unknown discriminator lists the values it allows', () => {
    expect(message(actions, { action: 'create', title: 'CV' })).toContain(
      'action: must be one of "guide", "init", "update"',
    )
  })
})

describe('a parameters wrapper the schema does not declare', () => {
  const schema = { properties: { id: {}, steps: {} } }
  test('an empty wrapper is dropped, a wrapper of declared fields is lifted', () => {
    expect(unwrapParameters({ id: 'p', parameters: null }, schema)).toEqual({ id: 'p' })
    expect(unwrapParameters({ id: 'p', parameters: { steps: [1] } }, schema)).toEqual({
      id: 'p',
      steps: [1],
    })
  })
  test('anything else is left for the schema to judge', () => {
    const raw = { id: 'p', parameters: { unknown: 1 } }
    expect(unwrapParameters(raw, schema)).toBe(raw)
  })
})
