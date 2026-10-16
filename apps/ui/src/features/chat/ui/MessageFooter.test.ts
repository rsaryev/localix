import { expect, test } from 'bun:test'
import { shouldShowCommandOrigin } from './MessageFooter'

test('shows command provenance only when the command is not already visible in the message', () => {
  const commandOrigin = { command: 'plugin install', label: 'Installing plugin' }
  expect(
    shouldShowCommandOrigin({
      content: '/plugin install owner/repo',
      commandOrigin,
    }),
  ).toBe(false)
  expect(
    shouldShowCommandOrigin({
      content: 'Scheduled timer check',
      commandOrigin,
    }),
  ).toBe(true)
})
