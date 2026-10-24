import { expect, test } from 'bun:test'
import { copyToClipboard } from './clipboard'

test('$.ui.copy says the machine has no clipboard where none can be reached', async () => {
  expect(await copyToClipboard('x', 'plan9')).toEqual({ isCopied: false, reason: 'no-clipboard' })
})
