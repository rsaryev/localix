import { expect, test } from 'bun:test'
import { memoryScopePolicy } from './scope-policy'

test('default recall preserves narrow-to-wide ordering and avoids implicit global writes', () => {
  expect(memoryScopePolicy('p', 's').scopes).toEqual(['session:s', 'p', ''])
  expect(memoryScopePolicy('p', 's').target()).toBe('p')
  expect(memoryScopePolicy(null, 's').target()).toBe('session:s')
})

test.each(['global', 'project', 'session'] as const)(
  '%s selection restricts reads and writes',
  (scope) => {
    const policy = memoryScopePolicy('p', 's', scope)
    const target = { global: '', project: 'p', session: 'session:s' }[scope]
    expect(policy.scopes).toEqual([target])
    expect(policy.target()).toBe(target)
    for (const other of ['global', 'project', 'session'] as const) {
      if (other !== scope) expect(() => policy.target(other)).toThrow('memory scope')
    }
  },
)

test('an unavailable selected scope never falls through to global', () => {
  const policy = memoryScopePolicy(null, 's', 'project')
  expect(policy.scopes).toEqual([])
  expect(() => policy.target()).toThrow('unavailable')
})
