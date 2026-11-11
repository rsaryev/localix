import { expect, test } from 'bun:test'
import { readHookSpecs } from './hook-specs'

/** The hooks an instance says it registered, read on the host as untrusted data. */

test('a spec that is not plain data, or names no event, refuses the whole answer', () => {
  for (const hooks of [
    [{ id: 1, event: 123, generator: false }],
    [{ id: 1, event: '', generator: false }],
    [{ id: 1.5, event: 'x', generator: false }],
    [{ id: 1, event: 'x', generator: 'no' }],
    [{ id: 1, event: 'x', generator: false, matcher: { command: /(a+)+$/ } }],
    [{ id: 1, event: 'x', generator: false, matcher: { f: () => true } }],
    [{ id: 1, event: 'x', generator: false, matcher: ['a'] }],
    // The kit's matcher is flat: a field holds literals, never an object to match inside.
    [{ id: 1, event: 'x', generator: false, matcher: { origin: { kind: 'a' } } }],
    [{ id: 1, event: 'x', generator: false, onError: { id: 0, generator: false } }],
    'hooks',
  ])
    expect(() => readHookSpecs({ hooks })).toThrow()
  expect(() => readHookSpecs(null)).toThrow()
})

test('a well-formed spec is copied, nothing else of it kept', () => {
  const [spec] = readHookSpecs({
    hooks: [
      {
        id: 2,
        event: 'command.run',
        generator: true,
        matcher: { command: ['a', 'b'], n: 1, on: true },
        onError: { id: 3, generator: false, extra: 'dropped' },
        extra: 'dropped',
      },
    ],
  })
  expect(spec).toEqual({
    id: 2,
    event: 'command.run',
    generator: true,
    matcher: { command: ['a', 'b'], n: 1, on: true },
    onError: { id: 3, generator: false },
  })
})

test('the fields the VM matches itself reach the host as filters that let every value through', () => {
  const [spec] = readHookSpecs({
    hooks: [{ id: 1, event: 'tool.call', generator: false, matcher: {}, inVm: ['tool'] }],
  })
  // The kit's chain sees a filtered hook (one of several on the event); the VM's RegExp decides.
  expect(spec?.matcher).toEqual({ tool: { $regexp: '', flags: '' } })
  for (const inVm of ['tool', [1], Array.from({ length: 65 }, (_, i) => `f${i}`)])
    expect(() =>
      readHookSpecs({ hooks: [{ id: 1, event: 'x', generator: false, matcher: {}, inVm }] }),
    ).toThrow()
})
