import { afterEach, expect, test } from 'bun:test'
import { installModelAliasResolver, resolveModelAlias } from './model-alias'

afterEach(() => installModelAliasResolver(undefined))

test('with no resolver installed every value runs on the parent model', () => {
  expect(resolveModelAlias('sonnet', 'parent')).toBe('parent')
  expect(resolveModelAlias('some/model', 'parent')).toBe('parent')
  expect(resolveModelAlias(undefined, undefined)).toBeUndefined()
})

test('the installed resolver decides', () => {
  const seen: unknown[] = []
  installModelAliasResolver({
    resolve: (...args) => {
      seen.push(args)
      return 'chosen'
    },
  })
  expect(resolveModelAlias('opus', 'parent', ['a'])).toBe('chosen')
  expect(seen).toEqual([['opus', 'parent', ['a']]])
})
