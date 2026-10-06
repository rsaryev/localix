import { expect, test } from 'bun:test'
import { AGENT_MARKS } from './agentMarks'
import { PROVIDER_ADAPTERS } from '../../backend/adapters/registry'

test('every roster provider has a distinct mark and no unknown provider glyphs', () => {
  expect(Object.keys(AGENT_MARKS).sort()).toEqual(
    PROVIDER_ADAPTERS.map((adapter) => adapter.id).sort(),
  )
  expect(new Set(Object.values(AGENT_MARKS)).size).toBe(PROVIDER_ADAPTERS.length)
})
