import { expect, test } from 'bun:test'

import { connectionRoster } from './market-data-overview'

test('an empty roster is an answer, not a failed call', () => {
  const result = connectionRoster([])
  expect(result.isError).toBeFalsy()
  expect(result.content).toContain('No trading connection is configured')
})
