import { expect, test } from 'bun:test'

import { addressedHandles, addressableProse } from './conversation-addressing'

test('prose addresses; code, fences, quotes and link targets only refer', () => {
  const text = [
    '@qa, please verify. `@dev` is busy.',
    '~~~',
    '@dev inside a tilde fence',
    '~~~',
    '> @dev wrote this',
    '[the log](https://ci.test/@dev) and <https://x.test/@dev>',
    'Then @dev: ship it.',
  ].join('\n')
  expect(addressedHandles(text, ['qa', 'dev'])).toEqual(['qa', 'dev'])
  expect(addressableProse('```\n@qa\n```')).not.toContain('@qa')
})

test('an unclosed fence hides the rest of the reply', () => {
  expect(addressedHandles('Example:\n```ts\n@qa()', ['qa'])).toEqual([])
})
