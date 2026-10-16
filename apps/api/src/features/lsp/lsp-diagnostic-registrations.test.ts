import { expect, test } from 'bun:test'
import { applyDiagnosticRegistrations } from './lsp-diagnostic-registrations'
import type { CapabilityRegistration } from './lsp-client-contract'

const entry = (id: string, identifier: string): CapabilityRegistration => ({
  id,
  method: 'textDocument/diagnostic',
  registerOptions: { identifier },
})

test('registration updates retain wire order, last value and the original entry objects', () => {
  const first = entry('same', 'first')
  const second = entry('same', 'replacement')
  const other = entry('other', 'other')
  const applied: CapabilityRegistration[] = []
  const registrations = new Map<string, CapabilityRegistration>()
  expect(
    applyDiagnosticRegistrations(
      [first, { id: 'ignored', method: 'textDocument/hover' }, other, second],
      (value) => {
        applied.push(value)
        registrations.set(value.id, value)
      },
    ),
  ).toBeNull()
  expect(applied).toEqual([first, other, second])
  expect(applied[0]).toBe(first)
  expect([...registrations.keys()]).toEqual(['same', 'other'])
  expect(registrations.get('same')).toBe(second)
  expect(
    applyDiagnosticRegistrations(undefined, () => {
      throw new Error('unused')
    }),
  ).toBeNull()
})

test('unregistration tolerates missing ids and filters unrelated methods', () => {
  const registrations = new Map([['same', entry('same', 'first')]])
  expect(
    applyDiagnosticRegistrations(
      [
        { id: 'same', method: 'textDocument/hover' },
        { id: 'absent', method: 'textDocument/diagnostic' },
      ],
      (value) => registrations.delete(value.id),
    ),
  ).toBeNull()
  expect(registrations.has('same')).toBe(true)
  applyDiagnosticRegistrations([{ id: 'same', method: 'textDocument/diagnostic' }], (value) =>
    registrations.delete(value.id),
  )
  expect(registrations.size).toBe(0)
})

test('invalid entries and failed writes propagate after earlier updates', () => {
  const first = entry('first', 'first')
  const applied: CapabilityRegistration[] = []
  expect(() =>
    applyDiagnosticRegistrations([first, null] as unknown as CapabilityRegistration[], (value) =>
      applied.push(value),
    ),
  ).toThrow(TypeError)
  expect(applied).toEqual([first])
  const failure = new Error('write failed')
  expect(() =>
    applyDiagnosticRegistrations([first, entry('second', 'second')], (value) => {
      applied.push(value)
      throw failure
    }),
  ).toThrow(failure)
  expect(applied).toEqual([first, first])
})
