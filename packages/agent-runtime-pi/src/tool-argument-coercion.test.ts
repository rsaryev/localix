/**
 * Stringified STRUCTURED arguments, end to end through the adapter.
 *
 * Several providers/models send a nested object or array argument as a JSON STRING while
 * sending the scalars beside it as real values. pi's argument coercion tolerated that for
 * every scalar type (`"12"` → `12`) but not for `object` or `array`, so a tool whose
 * parameter is an object was simply unreachable for those models: validation failed before
 * the tool ran, with `must be object` repeated once per union branch. That is a whole tool's
 * write path gone, reported as a schema error the model cannot fix by rewriting its call.
 *
 * The fix is a LOCALIX DELTA in the vendored `packages/ai/src/utils/validation.ts` (see
 * `vendor/pi/UPSTREAM.md`), and this is its tripwire: it lives in Localix's own tree so a
 * re-vendoring that drops the delta fails here rather than in production. It drives the real
 * path — our `toPiTool` bridge produces the schema, pi's own `validateToolArguments` checks it.
 */
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { validateToolArguments } from '@earendil-works/pi-ai'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'

import { toPiTool } from './tool-bridge'

const tool = (inputSchema: z.ZodType): ReturnType<typeof toPiTool> =>
  toPiTool(
    defineAgentTool({
      name: 'probe',
      description: 'probe',
      inputSchema,
      activeVerb: 'Probing',
      async execute() {
        return { content: 'ok' }
      },
    }) as AgentTool,
    undefined,
    new Map(),
    async () => {},
  )

const check = (inputSchema: z.ZodType, args: unknown) =>
  validateToolArguments(tool(inputSchema), { name: 'probe', arguments: args } as never)

const targetSchema = z.object({
  target: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('summary') }),
      z.object({ kind: z.literal('agent'), name: z.string() }),
    ])
    .optional(),
})

describe('tool arguments a model sent as JSON strings', () => {
  test('a stringified discriminated-union object is parsed into the branch it names', () => {
    expect(check(targetSchema, { target: '{"kind":"agent","name":"researcher"}' })).toEqual({
      target: { kind: 'agent', name: 'researcher' },
    })
  })

  test('a stringified array is parsed, and its items keep their own coercion', () => {
    const schema = z.object({ commands: z.array(z.string()), counts: z.array(z.number()) })
    expect(check(schema, { commands: '["ls","pwd"]', counts: '["1","2"]' })).toEqual({
      commands: ['ls', 'pwd'],
      counts: [1, 2],
    })
  })

  test('a nested object inside a stringified object is coerced too', () => {
    const schema = z.object({
      change: z.object({ kind: z.string(), limits: z.object({ n: z.number() }) }),
    })
    expect(check(schema, { change: '{"kind":"agent.update","limits":{"n":"7"}}' })).toEqual({
      change: { kind: 'agent.update', limits: { n: 7 } },
    })
  })

  test('a real object is untouched — the tolerance never rewrites a well-formed call', () => {
    expect(check(targetSchema, { target: { kind: 'summary' } })).toEqual({
      target: { kind: 'summary' },
    })
  })

  test('a string that is not JSON still fails, with the real type error', () => {
    // The tolerance accepts what can only mean one thing. Prose is not a stringified object,
    // and swallowing it would turn a type error into a confusing downstream failure.
    expect(() => check(targetSchema, { target: 'the researcher agent' })).toThrow(/must be object/)
  })

  test('JSON that parses but does not match the schema still fails', () => {
    expect(() => check(targetSchema, { target: '{"kind":"nope"}' })).toThrow()
  })
})

describe('the validation message a model repairs its call from', () => {
  const steps = z.strictObject({
    steps: z.array(z.strictObject({ action: z.enum(['click', 'press']), ref: z.string() })),
  })

  const message = (args: unknown) => {
    try {
      check(steps, args)
    } catch (error) {
      return (error as Error).message
    }
    throw new Error('expected a validation failure')
  }

  test('an unknown key is named once, as a parameter that is not accepted', () => {
    // TypeBox said it twice and said neither plainly: `schema is false` on the key and
    // `must not have additional properties` on its parent (gpt-6-luna repeated
    // `snapshot_after` per step across calls, LOCALIX-153/157).
    const text = message({ steps: [{ action: 'click', ref: 'e1', snapshot_after: true }] })
    expect(text).toContain('steps.0: unknown parameter "snapshot_after" — not accepted here')
    expect(text).not.toContain('schema is false')
  })

  test('an enum miss lists the values it allows', () => {
    expect(message({ steps: [{ action: 'wait', ref: 'e1' }] })).toContain(
      'steps.0.action: must be one of "click", "press"',
    )
  })
})

describe('a union the call has already chosen a branch of', () => {
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

  const message = (args: unknown) => {
    try {
      check(actions, args)
    } catch (error) {
      return (error as Error).message
    }
    throw new Error('expected a validation failure')
  }

  test('reports only the named branch, so the model fixes one field instead of dropping it all', () => {
    // LOCALIX-64/66: an `init` with one entry missing `link` read the `guide` branch's
    // complaints — every init field "not accepted here" — and the model resent init empty.
    const text = message({ action: 'init', title: 'CV', entries: [{ title: 'Go' }] })
    expect(text).toContain('entries.0.link')
    expect(text).not.toContain('not accepted here')
    expect(text).not.toContain('must be equal to constant')
  })

  test('narrows nested discriminated unions inside arrays as well', () => {
    const text = message({ action: 'update', operations: [{ op: 'add', entry: { title: 'Go' } }] })
    expect(text).toContain('operations.0.entry.link')
    expect(text).not.toContain('must be equal to constant')
  })

  test('an unknown discriminator lists the values it allows', () => {
    expect(message({ action: 'create', title: 'CV' })).toContain(
      'action: must be one of "guide", "init", "update"',
    )
  })
})
